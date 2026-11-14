import re
from pathlib import Path

from app.models import Account, MedicalAssignment, Mission
from app.security import verify_password
from app.seed import ALEX_ID, DOCTOR_ID, MIRA_ID, MISSION_ID, seed_demo
from app.db import SessionLocal

ROOT = Path(__file__).resolve().parents[2]


def test_seed_sources_do_not_contain_passwords():
    example = (ROOT / ".env.example").read_text(encoding="utf-8")
    api_seed = (ROOT / "backend" / "app" / "seed.py").read_text(encoding="utf-8")
    assert "ORBIT-DEMO-01" in api_seed
    assert "Mira-01" in api_seed
    assert "Alex-02" in api_seed
    assert "Flight-Doc" in api_seed
    assert re.search(r"password\s*[:=]\s*['\"][^'\"]+['\"]", api_seed) is None
    assert "SEED_MIRA_PASSWORD=\n" in example or "SEED_MIRA_PASSWORD=\r\n" in example
    assert "SEED_ALEX_PASSWORD=" in example
    assert "SEED_FLIGHT_DOC_PASSWORD=" in example
    assert "SUPABASE" not in example
    vite_lines = [line for line in example.splitlines() if line.startswith("VITE_")]
    assert vite_lines == ["VITE_ENVIRONMENT=demo", "VITE_API_URL=http://localhost:8000"]
    assert "service_role" not in example.lower()


def test_seed_creates_mission_and_stores_only_password_hashes(client):
    from datetime import datetime, timezone

    session = SessionLocal()
    try:
        seed_demo(
            session,
            emails={
                "mira": "mira-01@demo.artemia.local",
                "alex": "alex-02@demo.artemia.local",
                "doctor": "flight-doc@demo.artemia.local",
            },
            passwords={"mira": "mira-demo-pass", "alex": "alex-demo-pass", "doctor": "doctor-demo-pass"},
            start=datetime(2026, 11, 1, tzinfo=timezone.utc),
        )
        session.commit()
        mission = session.get(Mission, MISSION_ID)
        assert mission is not None
        assert mission.code == "ORBIT-DEMO-01"
        assert mission.mode == "extended"
        mira = session.get(Account, MIRA_ID)
        alex = session.get(Account, ALEX_ID)
        doctor = session.get(Account, DOCTOR_ID)
        assert mira is not None and alex is not None and doctor is not None
        assert "mira-demo-pass" not in mira.password_hash
        assert verify_password("mira-demo-pass", mira.password_hash)
        assert session.get(MedicalAssignment, __import__("app.seed", fromlist=["ASSIGNMENT_MIRA"]).ASSIGNMENT_MIRA) is not None
    finally:
        session.close()

    response = client.post(
        "/auth/login",
        json={"email": "mira-01@demo.artemia.local", "password": "mira-demo-pass"},
    )
    assert response.status_code == 200
    assert "access_token" in response.json()
    missing = client.post("/auth/register", json={"email": "new@demo.artemia.local", "password": "mira-demo-pass"})
    assert missing.status_code == 404
