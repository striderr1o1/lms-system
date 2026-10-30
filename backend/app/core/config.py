from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BACKEND_ROOT / ".env",
        extra="ignore",
    )

    database_url: str = ""
    supabase_url: str = "https://glmexxzdqstjcucojzff.supabase.co"
    supabase_jwks_url: str = (
        "https://glmexxzdqstjcucojzff.supabase.co/auth/v1/.well-known/jwks.json"
    )
    supabase_jwt_issuer: str = "https://glmexxzdqstjcucojzff.supabase.co/auth/v1"
    supabase_jwt_audience: str = "authenticated"
    frontend_origin: str = "http://localhost:5173"
    mux_token_id: str = ""
    mux_token_secret: str = ""
    mux_signing_key_id: str = ""
    mux_signing_private_key: str = ""
    mux_webhook_secret: str = ""


settings = Settings()
