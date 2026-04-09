"""
Application configuration using Pydantic Settings.
All settings are loaded from environment variables / .env file.
Switching LLM providers requires only LLM_PROVIDER + model name changes.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the JobHound backend."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = Field(
        default="postgresql+asyncpg://jobhound:localdev@db:5432/jobhound",
        description="Async PostgreSQL connection string",
    )

    # ── Auth ──────────────────────────────────────────────────────────────────
    google_client_id: str = Field(default="", description="Google OAuth client ID")
    google_client_secret: str = Field(default="", description="Google OAuth client secret")
    jwt_secret: str = Field(default="change-me-in-production", description="JWT signing secret")
    jwt_algorithm: str = Field(default="HS256", description="JWT algorithm")
    jwt_expiry_days: int = Field(default=7, description="JWT expiry in days")

    # ── LLM Provider ─────────────────────────────────────────────────────────
    llm_provider: str = Field(
        default="ollama",
        description="LLM provider: ollama | openai | anthropic | nebius",
    )
    ollama_url: str = Field(
        default="http://host.docker.internal:11434",
        description="Ollama base URL",
    )
    ollama_model: str = Field(default="llama3.1:8b", description="Ollama model name")
    openai_api_key: str = Field(default="", description="OpenAI API key")
    openai_model: str = Field(default="gpt-4o-mini", description="OpenAI model name")
    anthropic_api_key: str = Field(default="", description="Anthropic API key")
    anthropic_model: str = Field(
        default="claude-sonnet-4-20250514", description="Anthropic model name"
    )
    nebius_api_key: str = Field(default="", description="Nebius API key")
    nebius_model: str = Field(default="", description="Nebius model name")
    nebius_base_url: str = Field(default="", description="Nebius base URL")

    # ── Embedding Provider ────────────────────────────────────────────────────
    embedding_provider: str = Field(
        default="ollama",
        description="Embedding provider: ollama | openai",
    )
    embedding_model: str = Field(
        default="nomic-embed-text", description="Embedding model name"
    )
    embedding_dimension: int = Field(
        default=1536, description="Embedding vector dimensions"
    )

    # ── Admin / Approval ─────────────────────────────────────────────────────
    admin_email: str = Field(
        default="",
        description="Admin email — auto-approved and receives new-user access requests",
    )
    app_url: str = Field(
        default="http://localhost:3000",
        description="Public frontend URL used in email links (e.g. https://jobhound.example.com)",
    )

    # ── Resend (email delivery) ───────────────────────────────────────────────
    resend_api_key: str = Field(default="", description="Resend API key (resend.com)")
    resend_from_email: str = Field(
        default="",
        description='From address, e.g. "JobHound <noreply@yourdomain.com>". '
        "Defaults to Resend sandbox address if empty.",
    )

    # ── App ───────────────────────────────────────────────────────────────────
    debug: bool = Field(default=False, description="Enable debug mode")
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        description="Allowed CORS origins",
    )


settings = Settings()
