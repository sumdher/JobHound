"""
OpenAI embedding provider adapter.
Uses the official openai Python library's client.embeddings.create() method.
Supports both single and batch embedding in a single API call.
Configure via OPENAI_API_KEY and EMBEDDING_MODEL environment variables.
"""

from __future__ import annotations

from app.config import settings
from app.services.embedding.base import BaseEmbeddingProvider


class OpenAIEmbeddingProvider(BaseEmbeddingProvider):
    """Embedding provider backed by the OpenAI Embeddings API."""

    def _get_client(self):
        """Construct an AsyncOpenAI client."""
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:
            raise ValueError(
                "openai package is not installed. Run: pip install openai"
            ) from exc

        api_key = settings.openai_api_key
        if not api_key:
            raise ValueError("OPENAI_API_KEY is not configured.")

        return AsyncOpenAI(api_key=api_key)

    async def embed(self, text: str) -> list[float]:
        """Embed a single text string via the OpenAI Embeddings API."""
        client = self._get_client()
        model = settings.embedding_model

        try:
            response = await client.embeddings.create(input=text, model=model)
            return response.data[0].embedding
        except Exception as exc:
            raise ValueError(f"OpenAI embedding error: {exc}") from exc

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts in a single OpenAI Embeddings API call."""
        if not texts:
            return []

        client = self._get_client()
        model = settings.embedding_model

        try:
            response = await client.embeddings.create(input=texts, model=model)
            # Preserve original order: the API returns items sorted by index.
            sorted_data = sorted(response.data, key=lambda d: d.index)
            return [item.embedding for item in sorted_data]
        except Exception as exc:
            raise ValueError(f"OpenAI batch embedding error: {exc}") from exc
