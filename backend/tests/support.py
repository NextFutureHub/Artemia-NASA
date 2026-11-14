from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Account, MedicalAssignment, Mission, MissionMembership, Profile
from app.security import hash_password
from tests.payloads import MISSION_ID

MIRA = UUID("10000000-0000-4000-8000-000000000001")
ALEX = UUID("10000000-0000-4000-8000-000000000002")
DOCTOR = UUID("10000000-0000-4000-8000-000000000003")
STRANGER = UUID("10000000-0000-4000-8000-000000000004")
ASSIGNMENT_MIRA = UUID("10000000-0000-4000-8000-000000000021")
ASSIGNMENT_ALEX = UUID("10000000-0000-4000-8000-000000000022")
PASSWORD = "test-password"

PEOPLE = (
    (MIRA, "mira@demo.artemia.local", "Mira Example", "Mira-01", "astronaut"),
    (ALEX, "alex@demo.artemia.local", "Alex Example", "Alex-02", "astronaut"),
    (DOCTOR, "doctor@demo.artemia.local", "Flight Doctor", "Flight-Doc", "doctor"),
    (STRANGER, "stranger@demo.artemia.local", "Other Doctor", "Other-Doc", "doctor"),
)


def seed_people() -> None:
    session = SessionLocal()
    try:
        _seed(session)
        session.commit()
    finally:
        session.close()


def _seed(session: Session) -> None:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, tzinfo=timezone.utc)
    session.add(
        Mission(
            id=MISSION_ID,
            code="ORBIT-DEMO-01",
            name="Orbit demo",
            start_at=start,
            end_at=end,
            mode="extended",
            ruleset_version="1",
        )
    )
    password_hash = hash_password(PASSWORD)
    for user_id, email, _display_name, _callsign, _role in PEOPLE:
        session.add(Account(id=user_id, email=email, password_hash=password_hash))
    session.flush()
    for user_id, _email, display_name, callsign, _role in PEOPLE:
        session.add(Profile(id=user_id, display_name=display_name, callsign=callsign, locale="ru", timezone="UTC"))
    session.flush()
    for index, (user_id, _email, _display_name, _callsign, role) in enumerate(PEOPLE, start=1):
        session.add(
            MissionMembership(
                id=UUID(f"10000000-0000-4000-8000-00000000001{index}"),
                mission_id=MISSION_ID,
                user_id=user_id,
                role=role,
                active_from=start,
            )
        )
    session.flush()
    session.add(
        MedicalAssignment(
            id=ASSIGNMENT_MIRA,
            mission_id=MISSION_ID,
            patient_id=MIRA,
            doctor_id=DOCTOR,
            valid_from=start,
        )
    )
    session.add(
        MedicalAssignment(
            id=ASSIGNMENT_ALEX,
            mission_id=MISSION_ID,
            patient_id=ALEX,
            doctor_id=DOCTOR,
            valid_from=start,
        )
    )


def login(client, email: str) -> str:
    response = client.post("/auth/login", json={"email": email, "password": PASSWORD, "role": "doctor"})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def count_rows(model) -> int:
    session = SessionLocal()
    try:
        return int(session.scalar(select(func.count()).select_from(model)) or 0)
    finally:
        session.close()
