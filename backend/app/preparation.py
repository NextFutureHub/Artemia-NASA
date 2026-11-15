"""Read-only bundle for preparing one astronaut device. No other patient's data."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from app.access import active_assignment_filters
from app.models import (
    Checkin,
    CheckinMeasurement,
    CheckinRevision,
    Measurement,
    MedicalAssignment,
    MedicalProfile,
    Mission,
    MissionMembership,
    PersonalPreference,
    Profile,
    RuleDefinition,
    Source,
)


def preparation_bundle(session: Session, user_id: UUID) -> dict[str, object] | None:
    membership = session.scalar(
        select(MissionMembership)
        .where(
            MissionMembership.user_id == user_id,
            MissionMembership.role == "astronaut",
            MissionMembership.active_from <= func.now(),
            or_(MissionMembership.active_until.is_(None), MissionMembership.active_until > func.now()),
        )
        .order_by(MissionMembership.active_from.desc())
    )
    if membership is None:
        return None
    mission = session.get(Mission, membership.mission_id)
    profile = session.get(Profile, user_id)
    if mission is None or profile is None:
        return None
    return {
        "schema_version": 1,
        "role": "astronaut",
        "profile": {
            "id": str(profile.id),
            "display_name": profile.display_name,
            "callsign": profile.callsign,
            "locale": profile.locale,
            "timezone": profile.timezone,
            "unit_system": getattr(profile, "unit_system", None) or "metric",
        },
        "mission": {
            "id": str(mission.id),
            "code": mission.code,
            "name": mission.name,
            "start_at": _iso(mission.start_at),
            "end_at": _iso(mission.end_at),
            "mode": mission.mode,
            "default_timezone": mission.default_timezone,
            "emergency_contact_text": mission.emergency_contact_text,
            "ruleset_version": mission.ruleset_version,
            "demo_dataset_id": None if mission.demo_dataset_id is None else str(mission.demo_dataset_id),
        },
        "assignment": _assignment(session, user_id, mission.id),
        "medical_profile": _medical(session, user_id),
        "personal_preferences": _preferences(session, user_id),
        "sources": _sources(session),
        "rules": _rules(session),
        "history": {
            "checkins": _checkins(session, user_id, mission.id),
            "measurements": _measurements(session, user_id, mission.id),
        },
    }


def _assignment(session: Session, patient_id: UUID, mission_id: UUID) -> dict[str, object] | None:
    assignment = session.scalar(
        select(MedicalAssignment)
        .where(
            MedicalAssignment.patient_id == patient_id,
            MedicalAssignment.mission_id == mission_id,
            *active_assignment_filters(),
        )
        .order_by(MedicalAssignment.valid_from.desc())
    )
    if assignment is None:
        return None
    doctor = session.get(Profile, assignment.doctor_id)
    if doctor is None:
        return None
    return {
        "id": str(assignment.id),
        "doctor_id": str(assignment.doctor_id),
        "doctor_callsign": doctor.callsign,
        "doctor_display_name": doctor.display_name,
        "valid_from": _iso(assignment.valid_from),
        "valid_until": None if assignment.valid_until is None else _iso(assignment.valid_until),
        "revoked_at": None if assignment.revoked_at is None else _iso(assignment.revoked_at),
    }


def _medical(session: Session, subject_id: UUID) -> dict[str, object]:
    row = session.get(MedicalProfile, subject_id)
    if row is None:
        return {"age": None, "sex_context": None}
    return {"age": row.age, "sex_context": row.sex_context}


def _preferences(session: Session, subject_id: UUID) -> dict[str, object]:
    row = session.get(PersonalPreference, subject_id)
    if row is None:
        return {
            "reproductive_enabled": False,
            "cycle_context": None,
            "default_sharing": "device_only",
        }
    return {
        "reproductive_enabled": row.reproductive_enabled,
        "cycle_context": row.cycle_context,
        "default_sharing": row.default_sharing,
    }


def _sources(session: Session) -> list[dict[str, object]]:
    rows = session.scalars(select(Source).order_by(Source.id)).all()
    return [
        {
            "id": row.id,
            "title": row.title,
            "organization": row.organization,
            "url": row.url,
            "version_date": None if row.version_date is None else row.version_date.isoformat(),
            "accessed_at": row.accessed_at.isoformat(),
            "local_summary": row.local_summary,
            "limitations": row.limitations,
            "source_kind": row.source_kind,
        }
        for row in rows
    ]


def _rules(session: Session) -> list[dict[str, object]]:
    rows = session.scalars(select(RuleDefinition).order_by(RuleDefinition.rule_id)).all()
    return [
        {
            "rule_id": row.rule_id,
            "version": row.version,
            "rule_kind": row.rule_kind,
            "limitations": row.limitations,
            "demo_only": row.demo_only,
        }
        for row in rows
    ]


def current_dataset_id(session: Session, mission_id: UUID) -> UUID | None:
    mission = session.get(Mission, mission_id)
    if mission is None:
        return None
    return mission.demo_dataset_id


def _checkins(session: Session, subject_id: UUID, mission_id: UUID) -> list[dict[str, object]]:
    checkins = session.scalars(
        select(Checkin)
        .where(Checkin.subject_id == subject_id, Checkin.mission_id == mission_id, *_dataset_filter(Checkin.demo_dataset_id, current_dataset_id(session, mission_id)))
        .order_by(Checkin.recorded_at.desc())
        .limit(100)
    ).all()
    result: list[dict[str, object]] = []
    for checkin in checkins:
        revisions = session.scalars(
            select(CheckinRevision)
            .where(CheckinRevision.checkin_id == checkin.id)
            .order_by(CheckinRevision.revision_no)
        ).all()
        measurement_ids: list[str] = []
        for revision in revisions:
            links = session.scalars(
                select(CheckinMeasurement.measurement_id).where(CheckinMeasurement.revision_id == revision.id)
            ).all()
            measurement_ids.extend(str(item) for item in links)
        result.append(
            {
                "id": str(checkin.id),
                "mission_id": str(checkin.mission_id),
                "local_date": checkin.local_date.isoformat(),
                "timezone": checkin.timezone,
                "type": checkin.type,
                "root_id": str(checkin.root_id),
                "device_id": checkin.device_id,
                "recorded_at": _iso(checkin.recorded_at),
                "created_at_device": _iso(checkin.created_at_device),
                "source": checkin.source,
                "demo_dataset_id": None if checkin.demo_dataset_id is None else str(checkin.demo_dataset_id),
                "revisions": [
                    {
                        "id": str(revision.id),
                        "parent_revision_id": None
                        if revision.parent_revision_id is None
                        else str(revision.parent_revision_id),
                        "revision_no": revision.revision_no,
                        "general_payload": revision.general_payload,
                        "reason": revision.reason,
                        "schema_version": revision.schema_version,
                        "payload_hash": revision.payload_hash,
                    }
                    for revision in revisions
                ],
                "measurement_ids": measurement_ids,
            }
        )
    return result


def _measurements(session: Session, subject_id: UUID, mission_id: UUID) -> list[dict[str, object]]:
    rows = session.scalars(
        select(Measurement)
        .where(
            Measurement.subject_id == subject_id,
            Measurement.mission_id == mission_id,
            *_dataset_filter(Measurement.demo_dataset_id, current_dataset_id(session, mission_id)),
        )
        .order_by(Measurement.recorded_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "id": str(row.id),
            "metric": row.metric,
            "value": _number(row.value),
            "unit": row.unit,
            "source": row.source,
            "quality": row.quality,
            "quality_reasons": row.quality_reasons,
            "context": row.context,
            "note": row.note,
            "recorded_at": _iso(row.recorded_at),
            "created_at_device": _iso(row.created_at_device),
            "device_id": row.device_id,
            "demo_dataset_id": None if row.demo_dataset_id is None else str(row.demo_dataset_id),
        }
        for row in rows
    ]


def _dataset_filter(column, dataset_id: UUID | None):
    if dataset_id is None:
        return []
    return [column == dataset_id]


def _iso(value: datetime | date) -> str:
    return value.isoformat()


def _number(value: Decimal | None) -> int | float | None:
    if value is None:
        return None
    number = float(value)
    if number.is_integer():
        return int(number)
    return number
