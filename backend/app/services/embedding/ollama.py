"""
Ollama embedding provider adapter.
Calls POST {OLLAMA_URL}/api/embeddings with {"model": model, "prompt": text}.
For batch embedding, requests are issued sequentially.
Configure via OLLAMA_URL and EMBEDDING_MODEL environment variables.
"""

from __future__ import annotations

import httpx

from app.config import settings
from app.services.embedding.base import BaseEmbeddingProvider


class OllamaEmbeddingProvider(BaseEmbeddingProvider):
    """Embedding provider backed by Ollama's /api/embeddings endpoint."""

    def __init__(self) -> None:
        self._base_url: str = settings.ollama_url
        self._model: str = settings.embedding_model

    async def embed(self, text: str) -> list[float]:
        """Embed a single text string via Ollama."""
        url = f"{self._base_url}/api/embeddings"
        payload = {"model": self._model, "prompt": text}

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()
                embedding: list[float] = data["embedding"]
                return embedding
        except httpx.HTTPStatusError as exc:
            raise ValueError(
                f"Ollama embedding request failed with status "
                f"{exc.response.status_code}: {exc.response.text}"
            ) from exc
        except httpx.RequestError as exc:
            raise ValueError(f"Ollama embedding connection error: {exc}") from exc
        except (KeyError, TypeError) as exc:
            raise ValueError(f"Unexpected Ollama embedding response format: {exc}") from exc

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts sequentially via Ollama."""
        results: list[list[float]] = []
        for text in texts:
            vector = await self.embed(text)
            results.append(vector)
        return results
