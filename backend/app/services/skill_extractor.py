"""
Skill extraction service.
Uses the LLM to identify and normalize technical skills from job descriptions.
Returns canonical lowercase skill names for storage and deduplication.
"""

import json
import re
from pathlib import Path

import structlog

from app.services.llm.base import LLMConfig, Message
from app.services.llm.factory import get_llm_provider

logger = structlog.get_logger(__name__)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


async def extract_skills(
    job_description: str, config: LLMConfig | None = None
) -> list[str]:
    """
    Extract normalized skill names from a job description.

    Returns a list of lowercase canonical skill strings.
    Empty list on failure (non-fatal — applications can be saved without skills).
    """
    if not job_description or not job_description.strip():
        return []

    prompt_template = (PROMPTS_DIR / "extract_skills.txt").read_text()
    prompt = prompt_template.replace("{job_description}", job_description)

    provider = get_llm_provider(config)
    messages = [
        Message(
            role="system",
            content=(
                "You are a technical skill extractor. "
                "Always respond with a valid JSON array of strings only."
            ),
        ),
        Message(role="user", content=prompt),
    ]

    try:
        response = await provider.complete(messages, config)
        response = response.strip()

        # Direct parse
        try:
            skills = json.loads(response)
            if isinstance(skills, list):
                return [str(s).lower().strip() for s in skills if s and str(s).strip()]
        except json.JSONDecodeError:
            pass

        # Strip markdown
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", response)
        if match:
            try:
                skills = json.loads(match.group(1).strip())
                if isinstance(skills, list):
                    return [str(s).lower().strip() for s in skills if s]
            except json.JSONDecodeError:
                pass

        # Find array in response
        match = re.search(r"\[[\s\S]*?\]", response)
        if match:
            try:
                skills = json.loads(match.group(0))
                if isinstance(skills, list):
                    return [str(s).lower().strip() for s in skills if s]
            except json.JSONDecodeError:
                pass

        logger.warning(
            "Could not parse skills from LLM response", response=response[:200]
        )
        return []

    except Exception as e:
        logger.warning("Skill extraction failed (non-fatal)", error=str(e))
        return []
