"""
CV (resume) API.
  GET  /api/user/cv          — get stored CV text
  PUT  /api/user/cv          — save plain text CV
  POST /api/user/cv/pdf      — upload PDF, extract text, save
  POST /api/user/cv/analyze  — stream LLM job-fit analysis via SSE
"""

import asyncio
import json
from pathlib import Path

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
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


@router.get("")
async def get_cv(current_user: User = Depends(get_current_user)) -> dict:
    """Return the user's stored CV text."""
    return {"cv_text": current_user.cv_text or ""}


@router.put("")
async def save_cv_text(
    body: CVTextRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Save plain-text CV for the current user."""
    current_user.cv_text = body.cv_text.strip() or None
    await db.commit()
    logger.info("CV text saved", user=current_user.email)
    return {"cv_text": current_user.cv_text or ""}


@router.post("/pdf")
async def upload_cv_pdf(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upload a PDF, extract its text, and save as the user's CV."""
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
            # Fallback: pypdf (ships with many Python environments)
            import pypdf  # noqa: PLC0415
            reader = pypdf.PdfReader(io.BytesIO(content))
            for page in reader.pages:
                text = page.extract_text() or ""
                if text.strip():
                    pages_text.append(text.strip())
            extracted = "\n\n".join(pages_text).strip()
    except Exception as e:
        logger.error("PDF extraction failed", error=str(e))
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Could not extract text from PDF: {e}") from e

    if not extracted:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No text could be extracted from the PDF. Try pasting the text directly.")

    current_user.cv_text = extracted
    await db.commit()
    logger.info("CV extracted from PDF", user=current_user.email, chars=len(extracted))
    return {"cv_text": extracted, "pages": len(pages_text)}


@router.post("/analyze")
async def analyze_job_fit(
    body: AnalyzeRequest,
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Stream a job-fit analysis comparing the user's CV to a job description."""
    if not current_user.cv_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No CV saved. Upload or paste your CV first.")

    config: LLMConfig | None = None
    if body.provider or body.model or body.api_key:
        config = LLMConfig(
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url if body.provider != "ollama" else None,
        )

    prompt_template = (PROMPTS_DIR / "cv_analysis.txt").read_text()
    system_prompt = prompt_template.replace("{cv_text}", current_user.cv_text).replace("{job_description}", body.job_description)

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
