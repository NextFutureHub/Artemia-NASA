from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    token_secret: str
    token_ttl_seconds: int = 12 * 60 * 60
    bcrypt_rounds: int = 12
    cors_origins: str = "http://localhost:5173,http://localhost:4173"

    seed_mira_email: str = "mira-01@demo.artemia.local"
    seed_alex_email: str = "alex-02@demo.artemia.local"
    seed_flight_doc_email: str = "flight-doc@demo.artemia.local"
    seed_mira_password: str = ""
    seed_alex_password: str = ""
    seed_flight_doc_password: str = ""
    seed_mission_start_at: str = ""

    @model_validator(mode="after")
    def secret_is_long_enough(self) -> "Settings":
        if len(self.token_secret) < 32:
            raise ValueError("TOKEN_SECRET must be at least 32 characters")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
