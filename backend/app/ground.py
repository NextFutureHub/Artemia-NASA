"""Online physician reads. Nothing here is written to a medical offline cache."""

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import can_read_general, can_read_personal
from app.preparation import current_dataset_id
from app.canonical import hash_payload_part
from app.models import (
    AuditEvent,
    Checkin,
    CheckinRevision,
    DoctorMessage,
    DoctorPersonalMessage,
    MedicalAssignment,
    Profile,
    Report,
    ReportEvent,
    ReportPersonalPart,
)
from app.request_context import request_id_var


def inbox(session: Session, doctor_id: UUID) -> dict[str, object] | None:
    if not _is_doctor(session, doctor_id):
        return None
    assignments = session.scalars(
        select(MedicalAssignment).where(MedicalAssignment.doctor_id == doctor_id, MedicalAssignment.revoked_at.is_(None))
    ).all()
    active = [item for item in assignments if _assignment_current(item)]
    if not active:
        return _empty_inbox()
    assignment_ids = [item.id for item in active]
    reports = [
        report
        for report in session.scalars(select(Report).where(Report.recipient_assignment_id.in_(assignment_ids))).all()
        if _in_current_dataset(session, report.mission_id, report.demo_dataset_id)
    ]
    profiles = {
        profile.id: profile
        for profile in session.scalars(select(Profile).where(Profile.id.in_([item.subject_id for item in reports] or [doctor_id]))).all()
    }
    items: list[dict[str, object]] = []
    for report in reports:
        profile = profiles.get(report.subject_id)
        events = _events(session, report.id)
        work = _doctor_work(events)
        requested = report.reason == "review_request" or _review_requested(session, report)
        items.append(
            {
                "report_id": str(report.id),
                "mission_id": str(report.mission_id),
                "subject_id": str(report.subject_id),
                "callsign": "" if profile is None else profile.callsign,
                "display_name": "" if profile is None else profile.display_name,
                "title": report.title,
                "range_start": report.range_start.isoformat(),
                "range_end": report.range_end.isoformat(),
                "requested_review": requested,
                "received_at": report.created_at_server.isoformat(),
                "doctor_work": work,
            }
        )
    items.sort(key=lambda item: str(item["received_at"]), reverse=True)
    items.sort(key=lambda item: not bool(item["requested_review"]))
    return {
        "counts": {
            "new_reports": sum(1 for item in items if item["doctor_work"] == "not_opened"),
            "review_requested": sum(1 for item in items if item["requested_review"]),
            "replied": sum(1 for item in items if item["doctor_work"] == "replied"),
        },
        "order_note": "user_requests_not_triage",
        "items": items,
    }


def read_report(session: Session, actor_id: UUID, mission_id: UUID, report_id: UUID) -> dict[str, object] | None:
    report = session.get(Report, report_id)
    if report is None or report.mission_id != mission_id:
        return None
    if not can_read_general(session, actor_id, report.subject_id, report.mission_id):
        raise PermissionError
    profile = session.get(Profile, report.subject_id)
    events = _events(session, report.id)
    messages = session.scalars(
        select(DoctorMessage).where(DoctorMessage.report_id == report.id).order_by(DoctorMessage.created_at_server)
    ).all()
    recomputed = hash_payload_part(report.general_snapshot)
    return {
        "id": str(report.id),
        "mission_id": str(report.mission_id),
        "subject_id": str(report.subject_id),
        "callsign": "" if profile is None else profile.callsign,
        "display_name": "" if profile is None else profile.display_name,
        "title": report.title,
        "range_start": report.range_start.isoformat(),
        "range_end": report.range_end.isoformat(),
        "reason": report.reason,
        "message": report.message,
        "general_snapshot": report.general_snapshot,
        "general_hash": report.general_hash,
        "integrity": "match" if recomputed == report.general_hash else "mismatch",
        "received_at": report.created_at_server.isoformat(),
        "doctor_work": _doctor_work(events),
        "events": [{"event_type": event.event_type, "server_at": event.server_at.isoformat()} for event in events],
        "messages": [
            {
                "id": str(message.id),
                "message_type": message.message_type,
                "text": message.message_text,
                "sensitive": False,
                "created_at": message.created_at_server.isoformat(),
            }
            for message in messages
        ],
    }


def read_personal_report(session: Session, actor_id: UUID, mission_id: UUID, report_id: UUID) -> dict[str, object] | None:
    report = session.get(Report, report_id)
    if report is None or report.mission_id != mission_id:
        return None
    if not can_read_personal(session, actor_id, report.subject_id, report.mission_id):
        raise PermissionError
    part = session.get(ReportPersonalPart, report.id)
    messages = session.scalars(
        select(DoctorPersonalMessage)
        .where(DoctorPersonalMessage.report_id == report.id)
        .order_by(DoctorPersonalMessage.created_at_server)
    ).all()
    if part is None and not messages:
        return None
    return {
        "report_id": str(report.id),
        "personal_snapshot": None if part is None else part.personal_snapshot,
        "personal_hash": None if part is None else part.personal_hash,
        "messages": [
            {
                "id": str(message.id),
                "message_type": message.message_type,
                "text": message.message_text,
                "created_at": message.created_at_server.isoformat(),
            }
            for message in messages
        ],
    }


def mark_opened(session: Session, doctor_id: UUID, mission_id: UUID, report_id: UUID) -> dict[str, object]:
    report = _assigned_report(session, doctor_id, mission_id, report_id)
    existing = session.scalar(
        select(ReportEvent).where(ReportEvent.report_id == report.id, ReportEvent.event_type == "opened")
    )
    if existing is not None:
        return {"event_type": "opened", "server_at": existing.server_at.isoformat(), "created": False}
    now = datetime.now(timezone.utc)
    event = ReportEvent(
        id=uuid4(),
        report_id=report.id,
        subject_id=report.subject_id,
        mission_id=report.mission_id,
        event_type="opened",
        actor_id=doctor_id,
        server_at=now,
    )
    session.add(event)
    session.add(
        AuditEvent(
            id=uuid4(),
            actor_id=doctor_id,
            action="report_opened",
            entity_type="report",
            entity_id=report.id,
            request_id=request_id_var.get() or uuid4(),
        )
    )
    session.commit()
    return {"event_type": "opened", "server_at": now.isoformat(), "created": True}


def post_message(session: Session, doctor_id: UUID, mission_id: UUID, report_id: UUID, body: dict[str, object]) -> dict[str, object]:
    report = _assigned_report(session, doctor_id, mission_id, report_id)
    message_id = _uuid(body.get("id"), "message_id")
    message_type = body.get("message_type")
    text = body.get("text")
    sensitive = body.get("sensitive")
    if message_type not in ("acknowledgement", "clarifying_question", "comment"):
        raise ValueError("message_type")
    if not isinstance(text, str) or not 1 <= len(text) <= 3000:
        raise ValueError("message_text")
    if not isinstance(sensitive, bool):
        raise ValueError("sensitive")
    supersedes = body.get("supersedes_id")
    supersedes_id = None if supersedes in (None, "") else _uuid(supersedes, "supersedes_id")
    if sensitive and not can_read_personal(session, doctor_id, report.subject_id, report.mission_id):
        raise PermissionError
    existing = session.get(DoctorPersonalMessage if sensitive else DoctorMessage, message_id)
    if existing is not None:
        if existing.report_id != report.id or existing.message_text != text:
            raise ValueError("message_conflict")
        return {"id": str(existing.id), "created_at": existing.created_at_server.isoformat(), "doctor_work": "replied"}
    now = datetime.now(timezone.utc)
    if sensitive:
        session.add(
            DoctorPersonalMessage(
                id=message_id,
                report_id=report.id,
                subject_id=report.subject_id,
                mission_id=report.mission_id,
                author_id=doctor_id,
                message_type=message_type,
                message_text=text,
                supersedes_id=supersedes_id,
                created_at_server=now,
            )
        )
    else:
        session.add(
            DoctorMessage(
                id=message_id,
                report_id=report.id,
                subject_id=report.subject_id,
                mission_id=report.mission_id,
                author_id=doctor_id,
                message_type=message_type,
                message_text=text,
                sensitive=False,
                supersedes_id=supersedes_id,
                created_at_server=now,
            )
        )
    session.add(
        ReportEvent(
            id=uuid4(),
            report_id=report.id,
            subject_id=report.subject_id,
            mission_id=report.mission_id,
            event_type="replied",
            actor_id=doctor_id,
            server_at=now,
        )
    )
    session.add(
        AuditEvent(
            id=uuid4(),
            actor_id=doctor_id,
            action="doctor_message",
            entity_type="doctor_message",
            entity_id=message_id,
            request_id=request_id_var.get() or uuid4(),
        )
    )
    session.commit()
    return {"id": str(message_id), "created_at": now.isoformat(), "doctor_work": "replied"}


def crew_card(session: Session, doctor_id: UUID, mission_id: UUID, subject_id: UUID) -> dict[str, object] | None:
    if not can_read_general(session, doctor_id, subject_id, mission_id):
        raise PermissionError
    profile = session.get(Profile, subject_id)
    if profile is None:
        return None
    dataset = current_dataset_id(session, mission_id)
    checkin_query = select(Checkin).where(Checkin.subject_id == subject_id, Checkin.mission_id == mission_id)
    if dataset is not None:
        checkin_query = checkin_query.where(Checkin.demo_dataset_id == dataset)
    checkin = session.scalar(checkin_query.order_by(Checkin.recorded_at.desc()).limit(1))
    last = None
    if checkin is not None:
        revision = session.scalar(
            select(CheckinRevision).where(CheckinRevision.checkin_id == checkin.id).order_by(CheckinRevision.revision_no.desc()).limit(1)
        )
        overall = None if revision is None else revision.general_payload.get("overall_state")
        last = {
            "local_date": checkin.local_date.isoformat(),
            "recorded_at": checkin.recorded_at.isoformat(),
            "overall_state": overall,
        }
    return {
        "subject_id": str(subject_id),
        "callsign": profile.callsign,
        "display_name": profile.display_name,
        "mission_id": str(mission_id),
        "assignment_active": True,
        "last_delivered": last,
        "unsent_on_device": "unknown",
        "personal_allowed": can_read_personal(session, doctor_id, subject_id, mission_id),
    }


def _in_current_dataset(session: Session, mission_id: UUID, dataset_id: UUID | None) -> bool:
    current = current_dataset_id(session, mission_id)
    return current is None or dataset_id == current


def _assigned_report(session: Session, doctor_id: UUID, mission_id: UUID, report_id: UUID) -> Report:
    report = session.get(Report, report_id)
    if report is None or report.mission_id != mission_id:
        raise LookupError
    assignment = session.get(MedicalAssignment, report.recipient_assignment_id)
    if (
        assignment is None
        or assignment.doctor_id != doctor_id
        or assignment.patient_id != report.subject_id
        or not _assignment_current(assignment)
    ):
        raise PermissionError
    return report


def _events(session: Session, report_id: UUID) -> list[ReportEvent]:
    return list(
        session.scalars(select(ReportEvent).where(ReportEvent.report_id == report_id).order_by(ReportEvent.server_at)).all()
    )


def _doctor_work(events: list[ReportEvent]) -> str:
    kinds = {event.event_type for event in events}
    if "replied" in kinds:
        return "replied"
    if "opened" in kinds:
        return "opened"
    return "not_opened"


def _review_requested(session: Session, report: Report) -> bool:
    raw_ids = report.general_snapshot.get("revision_ids")
    if not isinstance(raw_ids, list):
        return False
    for raw in raw_ids:
        try:
            revision_id = UUID(str(raw))
        except ValueError:
            continue
        revision = session.get(CheckinRevision, revision_id)
        if revision is not None and revision.general_payload.get("review_requested") is True:
            return True
    return False


def _assignment_current(assignment: MedicalAssignment) -> bool:
    now = datetime.now(timezone.utc)
    if assignment.revoked_at is not None:
        return False
    if assignment.valid_from > now:
        return False
    if assignment.valid_until is not None and assignment.valid_until <= now:
        return False
    return True


def _is_doctor(session: Session, doctor_id: UUID) -> bool:
    from app.models import MissionMembership

    found = session.scalar(
        select(MissionMembership.id).where(MissionMembership.user_id == doctor_id, MissionMembership.role == "doctor")
    )
    return found is not None


def _empty_inbox() -> dict[str, object]:
    return {
        "counts": {"new_reports": 0, "review_requested": 0, "replied": 0},
        "order_note": "user_requests_not_triage",
        "items": [],
    }


def _uuid(value: object, code: str) -> UUID:
    try:
        return UUID(str(value))
    except ValueError as error:
        raise ValueError(code) from error
