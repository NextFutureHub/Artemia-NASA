import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
TOKEN_SECRET = "test-token-secret-value-32chars-min"
DEFAULT_DATABASE_URL = "postgresql+pg8000://artemia:artemia_test@127.0.0.1:54329/artemia_pytest"
CONTAINER = "artemia-p0-pytest-pg"

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", DEFAULT_DATABASE_URL)
os.environ["TOKEN_SECRET"] = TOKEN_SECRET
os.environ["BCRYPT_ROUNDS"] = "4"
os.environ["ALLOW_TEST_BCRYPT"] = "1"


def _ensure_container() -> None:
    if os.environ.get("TEST_DATABASE_URL"):
        return
    inspect = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
        capture_output=True,
        text=True,
    )
    if inspect.returncode != 0:
        subprocess.run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                CONTAINER,
                "-e",
                "POSTGRES_USER=artemia",
                "-e",
                "POSTGRES_PASSWORD=artemia_test",
                "-e",
                "POSTGRES_DB=artemia_pytest",
                "-p",
                "54329:5432",
                "postgres:16",
            ],
            check=True,
        )
        return
    if inspect.stdout.strip() != "true":
        subprocess.run(["docker", "start", CONTAINER], check=True)


def _wait_for_database() -> None:
    from sqlalchemy import create_engine, text

    deadline = time.time() + 60
    last_error = ""
    while time.time() < deadline:
        try:
            engine = create_engine(os.environ["DATABASE_URL"])
            with engine.connect() as connection:
                connection.execute(text("select 1"))
            engine.dispose()
            return
        except Exception as error:
            last_error = str(error)
            time.sleep(1)
    raise RuntimeError(f"PostgreSQL is not ready: {last_error}")


@pytest.fixture(scope="session")
def postgres():
    if "pytest" not in os.environ["DATABASE_URL"]:
        raise RuntimeError("Refusing to migrate a database URL that does not contain 'pytest'")
    _ensure_container()
    _wait_for_database()
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        check=True,
        env=os.environ.copy(),
    )
    yield


@pytest.fixture
def database(postgres):
    from sqlalchemy import text

    from app.db import Base, get_engine

    names = []
    for table in Base.metadata.sorted_tables:
        if table.name in {"sources", "rule_definitions"}:
            continue
        schema = table.schema or "public"
        names.append(f"{schema}.{table.name}")
    engine = get_engine()
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE " + ", ".join(names) + " RESTART IDENTITY CASCADE"))
    yield engine


@pytest.fixture
def client(database):
    from fastapi.testclient import TestClient

    from app.db import SessionLocal, get_db
    from app.main import app

    def override_db():
        session = SessionLocal()
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
