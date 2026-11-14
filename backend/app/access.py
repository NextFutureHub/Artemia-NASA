from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from app.models import ConsentEvent, MedicalAssignment, MissionMembership


def active_assignment_filters(assignment: type[MedicalAssignment] = MedicalAssignment):
    return (
        assignment.revoked_at.is_(None),
        assignment.valid_from <= func.now(),
        or_(assignment.valid_until.is_(None), assignment.valid_until > func.now()),
    )


def is_active_astronaut(session: Session, user_id: UUID, mission_id: UUID) -> bool:
    membership_id = session.scalar(
        select(MissionMembership.id).where(
            MissionMembership.user_id == user_id,
            MissionMembership.mission_id == mission_id,
            MissionMembership.role == "astronaut",
            MissionMembership.active_from <= func.now(),
            or_(MissionMembership.active_until.is_(None), MissionMembership.active_until > func.now()),
        )
    )
    return membership_id is not None


def assignment_is_active(session: Session, assignment_id: UUID, patient_id: UUID, mission_id: UUID) -> bool:
    found = session.scalar(
        select(MedicalAssignment.id).where(
            MedicalAssignment.id == assignment_id,
            MedicalAssignment.patient_id == patient_id,
            MedicalAssignment.mission_id == mission_id,
            *active_assignment_filters(),
        )
    )
    return found is not None


def can_read_general(session: Session, actor_id: UUID, subject_id: UUID, mission_id: UUID) -> bool:
    if actor_id == subject_id:
        return True
    found = session.scalar(
        select(MedicalAssignment.id).where(
            MedicalAssignment.patient_id == subject_id,
            MedicalAssignment.mission_id == mission_id,
            MedicalAssignment.doctor_id == actor_id,
            *active_assignment_filters(),
        )
    )
    return found is not None


def personal_consent_granted(session: Session, subject_id: UUID, mission_id: UUID, doctor_id: UUID) -> bool:
    decision = session.scalar(
        select(ConsentEvent.decision)
        .join(MedicalAssignment, MedicalAssignment.id == ConsentEvent.assignment_id)
        .where(
            ConsentEvent.subject_id == subject_id,
            ConsentEvent.scope == "personal_sharing",
            MedicalAssignment.patient_id == subject_id,
            MedicalAssignment.doctor_id == doctor_id,
            MedicalAssignment.mission_id == mission_id,
            *active_assignment_filters(),
        )
        .order_by(ConsentEvent.effective_at_server.desc(), ConsentEvent.recorded_at.desc())
        .limit(1)
    )
    return decision == "granted"


def can_read_personal(session: Session, actor_id: UUID, subject_id: UUID, mission_id: UUID) -> bool:
    if actor_id == subject_id:
        return True
    return can_read_general(session, actor_id, subject_id, mission_id) and personal_consent_granted(
        session, subject_id, mission_id, actor_id
    )
