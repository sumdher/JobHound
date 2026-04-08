"""
Embedding provider factory.
Returns the correct embedding provider based on the EMBEDDING_PROVIDER setting
or a per-request override.
"""

from __future__ import annotations

from app.config import settings
from app.services.embedding.base import BaseEmbeddingProvider


def get_embedding_provider(provider: str | None = None) -> BaseEmbeddingProvider:
    """
    Return the appropriate embedding provider.
    The optional *provider* argument overrides the global EMBEDDING_PROVIDER setting.
    """
    resolved = provider or settings.embedding_provider

    if resolved == "openai":
        from app.services.embedding.openai import OpenAIEmbeddingProvider

        return OpenAIEmbeddingProvider()
    else:  # default: ollama
        from app.services.embedding.ollama import OllamaEmbeddingProvider

        return OllamaEmbeddingProvider()
