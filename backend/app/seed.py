"""Synthetic mission ORBIT-DEMO-01. Passwords come only from the environment and are never printed."""

import sys
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    Account,
    MedicalAssignment,
    MedicalProfile,
    Mission,
    MissionMembership,
    PersonalPreference,
    Profile,
)
from app.security import hash_password

DATASET_ID = UUID("55555555-5555-4555-8555-555555555555")
MISSION_ID = UUID("11111111-1111-4111-8111-111111111111")
MIRA_ID = UUID("22222222-2222-4222-8222-222222222222")
ALEX_ID = UUID("33333333-3333-4333-8333-333333333333")
DOCTOR_ID = UUID("44444444-4444-4444-8444-444444444444")
MEMBERSHIP_MIRA = UUID("66666666-6666-4666-8666-666666666661")
MEMBERSHIP_ALEX = UUID("66666666-6666-4666-8666-666666666662")
MEMBERSHIP_DOCTOR = UUID("66666666-6666-4666-8666-666666666663")
ASSIGNMENT_MIRA = UUID("77777777-7777-4777-8777-777777777771")
ASSIGNMENT_ALEX = UUID("77777777-7777-4777-8777-777777777772")


def main() -> None:
    settings = get_settings()
    provided = {
        "SEED_MIRA_PASSWORD": settings.seed_mira_password,
        "SEED_ALEX_PASSWORD": settings.seed_alex_password,
        "SEED_FLIGHT_DOC_PASSWORD": settings.seed_flight_doc_password,
    }
    missing = [name for name, value in provided.items() if value == ""]
    if missing:
        raise SystemExit("Missing " + ", ".join(missing))
    start = _start_at(settings.seed_mission_start_at)
    session = SessionLocal()
    try:
        if "--fresh" in sys.argv:
            fresh_demo_dataset(session)
            session.commit()
            print("Fresh demo dataset assigned. Earlier rows stay. No receipt was written.", flush=True)
            return
        seed_demo(
            session,
            emails={
                "mira": settings.seed_mira_email,
                "alex": settings.seed_alex_email,
                "doctor": settings.seed_flight_doc_email,
            },
            passwords={
                "mira": provided["SEED_MIRA_PASSWORD"],
                "alex": provided["SEED_ALEX_PASSWORD"],
                "doctor": provided["SEED_FLIGHT_DOC_PASSWORD"],
            },
            start=start,
        )
        session.commit()
    except ValueError:
        session.rollback()
        raise SystemExit("Password length is not accepted") from None
    finally:
        session.close()
    print("Seeded ORBIT-DEMO-01 for Mira-01, Alex-02, and Flight-Doc", flush=True)


def seed_demo(session: Session, *, emails: dict[str, str], passwords: dict[str, str], start: datetime) -> None:
    end = start + timedelta(days=180)
    _mission(session, start, end)
    _account(session, MIRA_ID, emails["mira"], passwords["mira"], "Mira Example", "Mira-01")
    _account(session, ALEX_ID, emails["alex"], passwords["alex"], "Alex Example", "Alex-02")
    _account(session, DOCTOR_ID, emails["doctor"], passwords["doctor"], "Flight Doctor", "Flight-Doc")
    session.flush()
    _membership(session, MEMBERSHIP_MIRA, MIRA_ID, "astronaut", start)
    _membership(session, MEMBERSHIP_ALEX, ALEX_ID, "astronaut", start)
    _membership(session, MEMBERSHIP_DOCTOR, DOCTOR_ID, "doctor", start)
    _assignment(session, ASSIGNMENT_MIRA, MIRA_ID, start)
    _assignment(session, ASSIGNMENT_ALEX, ALEX_ID, start)
    _medical(session, MIRA_ID, 34, "female")
    _medical(session, ALEX_ID, 36, "male")
    _personal(session, MIRA_ID, True)
    _personal(session, ALEX_ID, False)


def fresh_demo_dataset(session: Session) -> UUID:
    """Point the mission at a new synthetic set. Previous rows and receipts stay."""
    mission = session.get(Mission, MISSION_ID)
    if mission is None:
        raise SystemExit("ORBIT-DEMO-01 is not seeded")
    fresh = uuid4()
    mission.demo_dataset_id = fresh
    return fresh


def _start_at(raw: str) -> datetime:
    if raw == "":
        return datetime.now(timezone.utc) - timedelta(days=14)
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        raise SystemExit("SEED_MISSION_START_AT is not a date") from None
    if parsed.tzinfo is None:
        raise SystemExit("SEED_MISSION_START_AT must include a timezone")
    return parsed


def _mission(session: Session, start: datetime, end: datetime) -> None:
    mission = session.get(Mission, MISSION_ID)
    if mission is None:
        session.add(
            Mission(
                id=MISSION_ID,
                code="ORBIT-DEMO-01",
                name="Orbit demo",
                start_at=start,
                end_at=end,
                mode="extended",
                default_timezone="UTC",
                emergency_contact_text="Используйте бортовой порядок обращения миссии. Это демонстрационный текст.",
                ruleset_version="1",
                demo_dataset_id=DATASET_ID,
            )
        )
        return
    mission.start_at = start
    mission.end_at = end
    if mission.demo_dataset_id is None:
        mission.demo_dataset_id = DATASET_ID


def _account(session: Session, user_id: UUID, email: str, password: str, display_name: str, callsign: str) -> None:
    password_hash = hash_password(password)
    account = session.get(Account, user_id)
    if account is None:
        session.add(Account(id=user_id, email=email, password_hash=password_hash))
    else:
        account.email = email
        account.password_hash = password_hash
    session.flush()
    profile = session.get(Profile, user_id)
    if profile is None:
        session.add(Profile(id=user_id, display_name=display_name, callsign=callsign, locale="ru", timezone="UTC"))
    else:
        profile.display_name = display_name
        profile.callsign = callsign


def _membership(session: Session, membership_id: UUID, user_id: UUID, role: str, start: datetime) -> None:
    row = session.get(MissionMembership, membership_id)
    if row is None:
        session.add(
            MissionMembership(
                id=membership_id,
                mission_id=MISSION_ID,
                user_id=user_id,
                role=role,
                active_from=start,
            )
        )
        return
    row.role = role
    row.active_from = start
    row.active_until = None


def _assignment(session: Session, assignment_id: UUID, patient_id: UUID, start: datetime) -> None:
    row = session.get(MedicalAssignment, assignment_id)
    if row is None:
        session.add(
            MedicalAssignment(
                id=assignment_id,
                mission_id=MISSION_ID,
                patient_id=patient_id,
                doctor_id=DOCTOR_ID,
                valid_from=start,
            )
        )
        return
    row.valid_from = start
    row.revoked_at = None
    row.valid_until = None


def _medical(session: Session, subject_id: UUID, age: int, sex_context: str) -> None:
    row = session.get(MedicalProfile, subject_id)
    if row is None:
        session.add(MedicalProfile(subject_id=subject_id, age=age, sex_context=sex_context, updated_revision=1))
        return
    changed = row.age != age or row.sex_context != sex_context
    row.age = age
    row.sex_context = sex_context
    if changed:
        row.updated_revision += 1


def _personal(session: Session, subject_id: UUID, reproductive_enabled: bool) -> None:
    row = session.get(PersonalPreference, subject_id)
    if row is None:
        session.add(
            PersonalPreference(
                subject_id=subject_id,
                reproductive_enabled=reproductive_enabled,
                cycle_context=None,
                default_sharing="device_only",
                revision=1,
            )
        )
        return
    changed = row.reproductive_enabled != reproductive_enabled or row.default_sharing != "device_only"
    row.reproductive_enabled = reproductive_enabled
    row.cycle_context = None
    row.default_sharing = "device_only"
    if changed:
        row.revision += 1


if __name__ == "__main__":
    main()
