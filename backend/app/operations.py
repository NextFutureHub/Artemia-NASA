"""Accept one operation. The same operation_id and hash return the same receipt."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access import assignment_is_active, is_active_astronaut, personal_consent_granted
from app.canonical import hash_operation, hash_payload_part
from app.constants import OPERATION_TYPES, SCHEMA_VERSION
from app.errors import ContractError, OperationResult
from app.models import (
    AuditEvent,
    ChangeLog,
    Checkin,
    CheckinMeasurement,
    CheckinPersonalRevision,
    CheckinRevision,
    ConsentEvent,
    InvalidationEvent,
    Measurement,
    MedicalAssignment,
    MedicalProfile,
    PersonalPreference,
    Profile,
    Report,
    ReportEvent,
    ReportPersonalPart,
    SyncReceipt,
)
from app.request_context import request_id_var
from app.validation import (
    HASH_RE,
    fail,
    is_int,
    measurement_number,
    optional_uuid,
    require_timestamp,
    require_uuid,
    validate_checkin_shape,
    validate_consent,
    validate_invalidation,
    validate_measurement,
    validate_preferences,
    validate_report_shape,
)


def deny(code: str) -> None:
    raise ContractError("forbidden", code)


def submit_operation(session: Session, actor_id: UUID, body: dict[str, Any]) -> OperationResult:
    try:
        result = _submit(session, actor_id, body)
    except ContractError as error:
        session.rollback()
        return OperationResult(error.status, error.code)
    except IntegrityError as error:
        session.rollback()
        return _from_integrity(session, actor_id, body, error)
    session.commit()
    return result


def _submit(session: Session, actor_id: UUID, body: dict[str, Any]) -> OperationResult:
    if any(key not in body for key in ("operation_id", "type", "schema_version", "payload", "hash")):
        raise ContractError("validation_error", "missing_argument")
    provided_hash = body["hash"]
    if not isinstance(provided_hash, str) or HASH_RE.fullmatch(provided_hash) is None:
        raise ContractError("validation_error", "hash_format")
    operation_id = require_uuid(body["operation_id"], "operation_id")
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _lock_key(operation_id)})
    existing = session.scalar(select(SyncReceipt).where(SyncReceipt.operation_id == operation_id))
    if existing is not None:
        if existing.actor_id != actor_id:
            return OperationResult("conflict", "operation_actor_mismatch")
        if existing.payload_hash != provided_hash:
            return OperationResult("conflict", "hash_mismatch")
        return OperationResult("duplicate", None, str(existing.receipt_id), existing.payload_hash, existing.entity_refs)

    if not is_int(body["schema_version"]) or body["schema_version"] != SCHEMA_VERSION:
        raise ContractError("validation_error", "unsupported_schema_version")
    operation_type = body["type"]
    if operation_type not in OPERATION_TYPES:
        raise ContractError("validation_error", "unknown_operation_type")
    payload = body["payload"]
    if not isinstance(payload, dict):
        raise ContractError("validation_error", "payload")
    _require_dependencies(session, actor_id, body.get("dependencies"))
    computed = hash_operation(SCHEMA_VERSION, operation_type, payload)
    if computed != provided_hash:
        raise ContractError("validation_error", "hash_mismatch")

    refs = _APPLY[operation_type](session, actor_id, payload)
    receipt_id = uuid4()
    session.add(
        SyncReceipt(
            receipt_id=receipt_id,
            operation_id=operation_id,
            actor_id=actor_id,
            operation_type=operation_type,
            payload_hash=computed,
            entity_refs=refs,
        )
    )
    session.add(
        AuditEvent(
            id=uuid4(),
            actor_id=actor_id,
            action="submit_accepted",
            entity_type=operation_type,
            entity_id=operation_id,
            request_id=request_id_var.get() or uuid4(),
        )
    )
    session.add(
        ChangeLog(
            scope=str(actor_id),
            entity_type=operation_type,
            entity_id=operation_id,
            actor_id=actor_id,
        )
    )
    session.flush()
    return OperationResult("accepted", None, str(receipt_id), computed, refs)


def _require_dependencies(session: Session, actor_id: UUID, dependencies: object) -> None:
    if dependencies is None:
        return
    if not isinstance(dependencies, list) or len(dependencies) > 32:
        raise ContractError("validation_error", "too_many_dependencies")
    for item in dependencies:
        dependency_id = require_uuid(item, "dependency")
        found = session.scalar(
            select(SyncReceipt.receipt_id).where(
                SyncReceipt.operation_id == dependency_id,
                SyncReceipt.actor_id == actor_id,
            )
        )
        if found is None:
            raise ContractError("validation_error", "unmet_dependency")


def _apply_checkin(session: Session, actor_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    bundle = validate_checkin_shape(payload)
    checkin = bundle["checkin"]
    revision = bundle["revision"]
    mission_id = require_uuid(checkin["mission_id"])
    if not is_active_astronaut(session, actor_id, mission_id):
        deny("not_mission_astronaut")
    checkin_id = require_uuid(checkin["id"])
    revision_id = require_uuid(revision["id"])
    root_id = require_uuid(checkin["root_id"])
    revision_no = revision["revision_no"]
    parent_id = optional_uuid(revision["parent_revision_id"], "parent_revision_id")
    measurement_ids = [require_uuid(item, "measurement_id") for item in bundle["measurement_ids"]]
    for measurement_id in measurement_ids:
        measurement = session.get(Measurement, measurement_id)
        if measurement is None or measurement.subject_id != actor_id or measurement.mission_id != mission_id:
            deny("measurement_not_owned")
    personal_id = _check_personal(session, actor_id, mission_id, bundle["personal"], recipient_id=None)

    existing = session.scalar(select(Checkin).where(Checkin.id == checkin_id).with_for_update())
    if existing is None:
        if revision_no != 1:
            raise ContractError("conflict", "parent_revision_conflict")
        session.add(
            Checkin(
                id=checkin_id,
                subject_id=actor_id,
                mission_id=mission_id,
                author_id=actor_id,
                device_id=checkin["device_id"],
                schema_version=SCHEMA_VERSION,
                local_date=_date(checkin["local_date"]),
                timezone=checkin["timezone"],
                type=checkin["type"],
                root_id=root_id,
                recorded_at=require_timestamp(checkin["recorded_at"], "recorded_at"),
                created_at_device=require_timestamp(checkin["created_at_device"], "created_at_device"),
                source=checkin["source"],
                demo_dataset_id=optional_uuid(checkin["demo_dataset_id"], "demo_dataset_id"),
            )
        )
        session.flush()
    else:
        if existing.subject_id != actor_id:
            deny("checkin_not_owned")
        if existing.root_id != root_id:
            fail("root_id")
        head = session.scalar(
            select(CheckinRevision)
            .where(CheckinRevision.checkin_id == checkin_id)
            .order_by(CheckinRevision.revision_no.desc())
            .limit(1)
            .with_for_update()
        )
        if head is None or parent_id != head.id or revision_no != head.revision_no + 1:
            raise ContractError("conflict", "parent_revision_conflict")

    general = revision["general_payload"]
    session.add(
        CheckinRevision(
            id=revision_id,
            checkin_id=checkin_id,
            subject_id=actor_id,
            mission_id=mission_id,
            parent_revision_id=parent_id,
            revision_no=revision_no,
            general_payload=general,
            reason=revision["reason"],
            schema_version=SCHEMA_VERSION,
            payload_hash=hash_payload_part(general),
        )
    )
    session.flush()
    if bundle["personal"] is not None:
        personal = bundle["personal"]
        session.add(
            CheckinPersonalRevision(
                id=require_uuid(personal["id"], "personal_id"),
                general_revision_id=revision_id,
                subject_id=actor_id,
                mission_id=mission_id,
                personal_payload=personal["personal_payload"],
                consent_event_id=require_uuid(personal["consent_event_id"], "personal_id"),
                payload_hash=hash_payload_part(personal["personal_payload"]),
                schema_version=SCHEMA_VERSION,
            )
        )
    for measurement_id in measurement_ids:
        session.add(
            CheckinMeasurement(
                revision_id=revision_id,
                measurement_id=measurement_id,
                subject_id=actor_id,
                mission_id=mission_id,
            )
        )
    return {
        "checkin_id": str(checkin_id),
        "revision_id": str(revision_id),
        "personal_revision_id": None if personal_id is None else str(personal_id),
        "measurement_ids": [str(item) for item in measurement_ids],
    }


def _check_personal(
    session: Session,
    actor_id: UUID,
    mission_id: UUID,
    personal: dict[str, Any] | None,
    recipient_id: UUID | None,
) -> UUID | None:
    if personal is None:
        return None
    personal_id = require_uuid(personal["id"], "personal_id") if "id" in personal else None
    consent_id = require_uuid(personal["consent_event_id"], "personal_consent")
    consent = session.get(ConsentEvent, consent_id)
    if (
        consent is None
        or consent.subject_id != actor_id
        or consent.scope != "personal_sharing"
        or consent.decision != "granted"
        or consent.assignment_id is None
    ):
        deny("personal_consent")
    if recipient_id is not None and consent.assignment_id != recipient_id:
        deny("personal_consent")
    if not assignment_is_active(session, consent.assignment_id, actor_id, mission_id):
        deny("personal_consent")
    assignment = session.get(MedicalAssignment, consent.assignment_id)
    if assignment is None or not personal_consent_granted(session, actor_id, mission_id, assignment.doctor_id):
        deny("personal_consent")
    return personal_id


def _apply_measurement(session: Session, actor_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    body = validate_measurement(payload)
    mission_id = require_uuid(body["mission_id"])
    if not is_active_astronaut(session, actor_id, mission_id):
        deny("not_mission_astronaut")
    measurement_id = require_uuid(body["id"])
    number = None if body["value"] is None else measurement_number(body["metric"], body["value"])
    session.add(
        Measurement(
            id=measurement_id,
            subject_id=actor_id,
            mission_id=mission_id,
            author_id=actor_id,
            device_id=body["device_id"],
            metric=body["metric"],
            value=number,
            unit=body["unit"],
            source=body["source"],
            quality=body["quality"],
            quality_reasons=body["quality_reasons"],
            context=body["context"],
            note=body["note"],
            device_metadata=body["device_metadata"],
            algorithm_version=body["algorithm_version"],
            attempt_id=optional_uuid(body["attempt_id"], "attempt_id"),
            schema_version=SCHEMA_VERSION,
            recorded_at=require_timestamp(body["recorded_at"], "recorded_at"),
            created_at_device=require_timestamp(body["created_at_device"], "created_at_device"),
            demo_dataset_id=optional_uuid(body["demo_dataset_id"], "demo_dataset_id"),
        )
    )
    return {"measurement_id": str(measurement_id)}


def _apply_invalidation(session: Session, actor_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    body = validate_invalidation(payload)
    mission_id = require_uuid(body["mission_id"])
    if not is_active_astronaut(session, actor_id, mission_id):
        deny("not_mission_astronaut")
    target_id = require_uuid(body["target_id"])
    target = _owned_target(session, body["target_type"], target_id)
    if target is None or target.subject_id != actor_id or target.mission_id != mission_id:
        deny("target_not_owned")
    event_id = require_uuid(body["id"])
    session.add(
        InvalidationEvent(
            id=event_id,
            subject_id=actor_id,
            mission_id=mission_id,
            author_id=actor_id,
            target_type=body["target_type"],
            target_id=target_id,
            reason=body["reason"],
            device_id=body["device_id"],
            recorded_at=require_timestamp(body["recorded_at"], "recorded_at"),
        )
    )
    return {"invalidation_id": str(event_id), "target_id": str(target_id)}


def _apply_preferences(session: Session, actor_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    body = validate_preferences(payload)
    profile = session.get(Profile, actor_id)
    if profile is None:
        fail("profile_missing")
    now = datetime.now(timezone.utc)
    profile.locale = body["locale"]
    profile.timezone = body["timezone"]
    profile.updated_at = now
    medical = session.get(MedicalProfile, actor_id)
    if medical is None:
        session.add(
            MedicalProfile(
                subject_id=actor_id,
                age=body["age"],
                sex_context=body["sex_context"],
                updated_revision=1,
                updated_at=now,
            )
        )
    else:
        medical.age = body["age"]
        medical.sex_context = body["sex_context"]
        medical.updated_revision += 1
        medical.updated_at = now
    preferences = session.get(PersonalPreference, actor_id)
    if preferences is None:
        session.add(
            PersonalPreference(
                subject_id=actor_id,
                reproductive_enabled=body["reproductive_enabled"],
                cycle_context=body["cycle_context"],
                default_sharing=body["default_sharing"],
                revision=1,
                updated_at=now,
            )
        )
    else:
        preferences.reproductive_enabled = body["reproductive_enabled"]
        preferences.cycle_context = body["cycle_context"]
        preferences.default_sharing = body["default_sharing"]
        preferences.revision += 1
        preferences.updated_at = now
    return {"subject_id": str(actor_id)}


def _apply_consent(session: Session, actor_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    body = validate_consent(payload)
    mission_id = require_uuid(body["mission_id"])
    if not is_active_astronaut(session, actor_id, mission_id):
        deny("not_mission_astronaut")
    assignment_id = optional_uuid(body["assignment_id"], "assignment_id")
    if assignment_id is not None:
        assignment = session.get(MedicalAssignment, assignment_id)
        if assignment is None or assignment.patient_id != actor_id or assignment.mission_id != mission_id:
            deny("assignment")
    supersedes_id = optional_uuid(body["supersedes_id"], "supersedes_id")
    if supersedes_id is not None:
        previous = session.get(ConsentEvent, supersedes_id)
        if previous is None or previous.subject_id != actor_id:
            fail("supersedes_id")
    consent_id = require_uuid(body["id"])
    session.add(
        ConsentEvent(
            id=consent_id,
            subject_id=actor_id,
            mission_id=mission_id,
            scope=body["scope"],
            decision=body["decision"],
            assignment_id=assignment_id,
            supersedes_id=supersedes_id,
            recorded_at=require_timestamp(body["recorded_at"], "recorded_at"),
            effective_at_server=datetime.now(timezone.utc),
            schema_version=SCHEMA_VERSION,
            created_at_device=require_timestamp(body["created_at_device"], "created_at_device"),
        )
    )
    return {"consent_event_id": str(consent_id)}


def _apply_report(session: Session, actor_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    bundle = validate_report_shape(payload)
    report = bundle["report"]
    snapshot = report["general_snapshot"]
    mission_id = require_uuid(report["mission_id"])
    if not is_active_astronaut(session, actor_id, mission_id):
        deny("not_mission_astronaut")
    recipient_id = require_uuid(report["recipient_assignment_id"])
    if not assignment_is_active(session, recipient_id, actor_id, mission_id):
        deny("recipient")
    parent_id = optional_uuid(report["parent_report_id"], "parent_report")
    if parent_id is not None:
        parent = session.get(Report, parent_id)
        if parent is None or parent.subject_id != actor_id or parent.mission_id != mission_id:
            fail("parent_report")
    for revision_id in snapshot["revision_ids"]:
        revision = session.get(CheckinRevision, require_uuid(revision_id, "revision_id"))
        if revision is None or revision.subject_id != actor_id or revision.mission_id != mission_id:
            deny("revision_not_owned")
    for item in snapshot["measurements"]:
        measurement = session.get(Measurement, require_uuid(item["measurement_id"], "snapshot_measurement"))
        if measurement is None or measurement.subject_id != actor_id or measurement.mission_id != mission_id:
            fail("snapshot_measurement")
        if not _snapshot_matches(measurement, item):
            fail("snapshot_measurement")
    personal_included = bundle["personal"] is not None
    if personal_included:
        _check_personal(session, actor_id, mission_id, bundle["personal"], recipient_id)
    report_id = require_uuid(report["id"])
    session.add(
        Report(
            id=report_id,
            subject_id=actor_id,
            mission_id=mission_id,
            author_id=actor_id,
            recipient_assignment_id=recipient_id,
            title=report["title"],
            range_start=_date(report["range_start"]),
            range_end=_date(report["range_end"]),
            reason=report["reason"],
            message=report["message"],
            general_snapshot=snapshot,
            general_hash=hash_payload_part(snapshot),
            parent_report_id=parent_id,
            schema_version=SCHEMA_VERSION,
            device_id=report["device_id"],
            recorded_at=require_timestamp(report["recorded_at"], "recorded_at"),
            created_at_device=require_timestamp(report["created_at_device"], "created_at_device"),
        )
    )
    session.flush()
    if personal_included:
        personal = bundle["personal"]
        session.add(
            ReportPersonalPart(
                report_id=report_id,
                subject_id=actor_id,
                mission_id=mission_id,
                personal_snapshot=personal["personal_snapshot"],
                personal_hash=hash_payload_part(personal["personal_snapshot"]),
                consent_event_id=require_uuid(personal["consent_event_id"], "personal_consent"),
                schema_version=SCHEMA_VERSION,
            )
        )
    session.add(
        ReportEvent(
            id=uuid4(),
            report_id=report_id,
            subject_id=actor_id,
            mission_id=mission_id,
            event_type="accepted",
            actor_id=actor_id,
        )
    )
    return {"report_id": str(report_id), "personal_included": personal_included}


def _snapshot_matches(measurement: Measurement, item: dict[str, Any]) -> bool:
    if measurement.metric != item["metric"] or measurement.unit != item["unit"]:
        return False
    if measurement.source != item["source"] or measurement.quality != item["quality"]:
        return False
    recorded = require_timestamp(item["recorded_at"], "snapshot_measurement")
    if measurement.recorded_at.astimezone(timezone.utc) != recorded.astimezone(timezone.utc):
        return False
    if measurement.value is None or item["value"] is None:
        return measurement.value is None and item["value"] is None
    return Decimal(measurement.value) == Decimal(str(item["value"]))


def _owned_target(session: Session, target_type: str, target_id: UUID):
    if target_type == "checkin":
        return session.get(Checkin, target_id)
    if target_type == "measurement":
        return session.get(Measurement, target_id)
    return session.get(Report, target_id)


def _date(value: str):
    return datetime.strptime(value, "%Y-%m-%d").date()


def _lock_key(value: UUID) -> int:
    return int.from_bytes(value.bytes[:8], "big", signed=True)


def _from_integrity(session: Session, actor_id: UUID, body: dict[str, Any], error: IntegrityError) -> OperationResult:
    constraint = ""
    orig = getattr(error, "orig", None)
    diag = getattr(orig, "diag", None)
    if diag is not None and getattr(diag, "constraint_name", None):
        constraint = diag.constraint_name
    if constraint == "uq_sync_receipts_operation_id":
        try:
            operation_id = UUID(str(body.get("operation_id")))
        except ValueError:
            return OperationResult("conflict", "operation_conflict")
        existing = session.scalar(select(SyncReceipt).where(SyncReceipt.operation_id == operation_id))
        provided = body.get("hash")
        if existing is not None and existing.actor_id == actor_id and existing.payload_hash == provided:
            return OperationResult("duplicate", None, str(existing.receipt_id), existing.payload_hash, existing.entity_refs)
        if existing is not None and existing.actor_id != actor_id:
            return OperationResult("conflict", "operation_actor_mismatch")
        return OperationResult("conflict", "hash_mismatch")
    return OperationResult("validation_error", "duplicate_entity")


_APPLY = {
    "checkin_bundle": _apply_checkin,
    "measurement": _apply_measurement,
    "report_bundle": _apply_report,
    "invalidation": _apply_invalidation,
    "profile_preferences": _apply_preferences,
    "consent_change": _apply_consent,
}
