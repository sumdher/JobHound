"""
CV (resume) API.
  GET  /api/user/cv                      — get stored CV text + metadata
  PUT  /api/user/cv                      — save plain text CV
  POST /api/user/cv/pdf                  — upload PDF, extract text, save
  POST /api/user/cv/analyze              — stream LLM job-fit analysis via SSE
  GET  /api/user/cv/analyses             — list saved CV analyses
  POST /api/user/cv/analyses             — save a CV analysis
  DELETE /api/user/cv/analyses/{id}      — delete a CV analysis
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.cv_analysis import CvAnalysis
from app.models.user import User
from app.services.llm.base import LLMConfig, Message
from app.services.llm.factory import get_llm_provider

router = APIRouter()
logger = structlog.get_logger(__name__)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class CVTextRequest(BaseModel):
    cv_text: str


class AnalyzeRequest(BaseModel):
    job_description: str
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class AnalysisCreateRequest(BaseModel):
    title: str | None = None
    job_description: str | None = None
    content: str


class AnalysisOut(BaseModel):
    id: str
    title: str
    job_description: str | None = None
    content: str
    created_at: str


def _normalized_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^[*#\-•\s]+", "", line).strip()
        line = re.sub(r"^\**\s*", "", line).strip()
        lines.append(line)
    return lines


def _trim_title(text: str, fallback: str = "Saved Analysis") -> str:
    stripped = " ".join(text.strip().split())
    if not stripped:
        return fallback
    if len(stripped) <= 60:
        return stripped
    truncated = stripped[:60]
    last_space = truncated.rfind(" ")
    return (truncated[:last_space] if last_space > 20 else truncated) + "..."


def _extract_labeled_value(lines: list[str], labels: tuple[str, ...]) -> str | None:
    for line in lines:
        lowered = line.lower()
        for label in labels:
            prefix = f"{label}:"
            if lowered.startswith(prefix):
                value = line[len(prefix):].strip()
                if value:
                    return value
    return None


def _title_from_text(
    text: str,
    *,
    title_hint: str | None = None,
    fallback: str = "Saved Analysis",
) -> str:
    lines = _normalized_lines(text)
    role = _extract_labeled_value(lines, ("job title", "title", "role", "position"))
    company = _extract_labeled_value(lines, ("company", "organization", "employer"))
    if role and company:
        return _trim_title(f"{role} at {company}", fallback=fallback)
    if role:
        return _trim_title(role, fallback=fallback)
    if title_hint:
        return _trim_title(title_hint, fallback=fallback)
    if lines:
        first_line = re.sub(r"^(job title|title|role|position):\s*", "", lines[0], flags=re.IGNORECASE)
        return _trim_title(first_line, fallback=fallback)
    return fallback


@router.get("")
async def get_cv(current_user: User = Depends(get_current_user)) -> dict:
    return {
        "cv_text": current_user.cv_text or "",
        "cv_filename": current_user.cv_filename,
        "cv_uploaded_at": current_user.cv_uploaded_at.isoformat() if current_user.cv_uploaded_at else None,
    }


@router.put("")
async def save_cv_text(
    body: CVTextRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    stripped = body.cv_text.strip()
    current_user.cv_text = stripped or None
    if not stripped:
        current_user.cv_filename = None
        current_user.cv_uploaded_at = None
    await db.commit()
    logger.info("CV text saved", user=current_user.email)
    return {
        "cv_text": current_user.cv_text or "",
        "cv_filename": current_user.cv_filename,
        "cv_uploaded_at": current_user.cv_uploaded_at.isoformat() if current_user.cv_uploaded_at else None,
    }


@router.post("/pdf")
async def upload_cv_pdf(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF files are accepted.")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF exceeds 10 MB limit.")

    try:
        import io
        extracted = ""
        pages_text: list[str] = []
        try:
            import pdfplumber  # noqa: PLC0415
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page in pdf.pages:
                    text = page.extract_text()
                    if text:
                        pages_text.append(text.strip())
            extracted = "\n\n".join(pages_text).strip()
        except ImportError:
            import pypdf  # noqa: PLC0415
            reader = pypdf.PdfReader(io.BytesIO(content))
            for page in reader.pages:
                text = page.extract_text() or ""
                if text.strip():
                    pages_text.append(text.strip())
            extracted = "\n\n".join(pages_text).strip()
    except Exception as e:
        logger.error("PDF extraction failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not extract text from PDF: {e}",
        ) from e

    if not extracted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No text could be extracted from the PDF. Try pasting the text directly.",
        )

    now = datetime.now(timezone.utc)
    current_user.cv_text = extracted
    current_user.cv_filename = file.filename
    current_user.cv_uploaded_at = now
    await db.commit()
    logger.info("CV extracted from PDF", user=current_user.email, chars=len(extracted))
    return {
        "cv_text": extracted,
        "pages": len(pages_text),
        "cv_filename": file.filename,
        "cv_uploaded_at": now.isoformat(),
    }


@router.post("/analyze")
async def analyze_job_fit(
    body: AnalyzeRequest,
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    if not current_user.cv_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No CV saved. Upload or paste your CV first.",
        )

    config: LLMConfig | None = None
    if body.provider or body.model or body.api_key:
        config = LLMConfig(
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url if body.provider != "ollama" else None,
        )

    prompt_template = (PROMPTS_DIR / "cv_analysis.txt").read_text()
    system_prompt = (
        prompt_template
        .replace("{cv_text}", current_user.cv_text)
        .replace("{job_description}", body.job_description)
    )

    messages = [
        Message(role="system", content=system_prompt),
        Message(role="user", content="Analyze my fit for this job and suggest specific CV improvements."),
    ]

    async def event_generator():
        yield ": heartbeat\n\n"
        queue: asyncio.Queue[tuple[str, str | None]] = asyncio.Queue()

        async def _fill() -> None:
            try:
                provider = get_llm_provider(config)
                async for token in provider.stream(messages, config):
                    await queue.put(("token", token))
            except Exception as e:
                logger.error("CV analysis stream error", error=str(e))
                await queue.put(("error", str(e)))
            finally:
                await queue.put(("done", None))

        task = asyncio.create_task(_fill())
        try:
            while True:
                try:
                    kind, value = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                if kind == "token":
                    yield f"data: {json.dumps({'token': value})}\n\n"
                elif kind == "error":
                    yield f"data: {json.dumps({'error': value})}\n\n"
                    break
                else:
                    break
        finally:
            task.cancel()
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# CV Analyses
# ---------------------------------------------------------------------------


@router.get("/analyses", response_model=list[AnalysisOut])
async def list_cv_analyses(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AnalysisOut]:
    result = await db.execute(
        select(CvAnalysis)
        .where(CvAnalysis.user_id == current_user.id)
        .order_by(CvAnalysis.created_at.desc())
    )
    analyses = result.scalars().all()
    return [
        AnalysisOut(
            id=str(a.id),
            title=a.title,
            job_description=a.job_description,
            content=a.content,
            created_at=a.created_at.isoformat(),
        )
        for a in analyses
    ]


@router.get("/analyses/{analysis_id}", response_model=AnalysisOut)
async def get_cv_analysis(
    analysis_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AnalysisOut:
    try:
        aid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid analysis_id format.")
    result = await db.execute(
        select(CvAnalysis).where(
            CvAnalysis.id == aid,
            CvAnalysis.user_id == current_user.id,
        )
    )
    analysis = result.scalar_one_or_none()
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")
    return AnalysisOut(
        id=str(analysis.id),
        title=analysis.title,
        job_description=analysis.job_description,
        content=analysis.content,
        created_at=analysis.created_at.isoformat(),
    )


@router.post("/analyses", response_model=AnalysisOut, status_code=status.HTTP_201_CREATED)
async def create_cv_analysis(
    body: AnalysisCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AnalysisOut:
    title = _title_from_text(body.job_description or body.title or body.content, title_hint=body.title)
    analysis = CvAnalysis(
        user_id=current_user.id,
        title=title,
        job_description=body.job_description.strip() if body.job_description else None,
        content=body.content,
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)
    return AnalysisOut(
        id=str(analysis.id),
        title=analysis.title,
        job_description=analysis.job_description,
        content=analysis.content,
        created_at=analysis.created_at.isoformat(),
    )


@router.delete("/analyses/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cv_analysis(
    analysis_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    try:
        aid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid analysis_id format.")
    result = await db.execute(
        select(CvAnalysis).where(
            CvAnalysis.id == aid,
            CvAnalysis.user_id == current_user.id,
        )
    )
    analysis = result.scalar_one_or_none()
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")
    await db.delete(analysis)
    await db.commit()
