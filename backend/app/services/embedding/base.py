"""
Base class for all embedding provider adapters.
All adapters implement embed() and embed_batch() with the same interface.
Switching provider requires only env var changes, no code changes.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseEmbeddingProvider(ABC):
    """Abstract base class for all embedding providers."""

    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        """Embed a single string and return its vector as a list of floats."""
        ...

    @abstractmethod
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """
        Embed a list of strings and return a list of vectors.
        The order of returned vectors matches the order of input texts.
        """
        ...
