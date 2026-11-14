"""Care tasks between assigned physician and astronaut. Not medication prescribing."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import active_assignment_filters, can_read_general, is_active_astronaut
from app.errors import ContractError
from app.models import (
    AuditEvent,
    CareOrder,
    CareOrderEvent,
    CareOrderResponse,
    ChangeLog,
    MedicalAssignment,
    MissionMembership,
)
from app.request_context import request_id_var
from app.validation import optional_uuid, require_due_timestamp, require_timestamp, require_uuid

CARE_KINDS = ("examination", "measurement", "recommendation", "symptom_monitor", "follow_up")
CARE_DECISIONS = ("done", "skipped", "acknowledged")


def list_crew_orders(session: Session, doctor_id: UUID, mission_id: UUID, subject_id: UUID) -> dict[str, object]:
    if not can_read_general(session, doctor_id, subject_id, mission_id):
        raise PermissionError
    orders = session.scalars(
        select(CareOrder)
        .where(CareOrder.mission_id == mission_id, CareOrder.subject_id == subject_id)
        .order_by(CareOrder.updated_at.desc())
    ).all()
    return {"items": [_order_card(session, order) for order in orders]}


def list_board_orders(session: Session, subject_id: UUID) -> dict[str, object]:
    orders = session.scalars(
        select(CareOrder).where(CareOrder.subject_id == subject_id).order_by(CareOrder.updated_at.desc())
    ).all()
    return {"items": [_order_card(session, order) for order in orders]}


def create_order(session: Session, doctor_id: UUID, mission_id: UUID, subject_id: UUID, body: dict[str, Any]) -> dict[str, object]:
    assignment = _active_assignment(session, doctor_id, mission_id, subject_id)
    order_id = require_uuid(body.get("id"), "id") if body.get("id") not in (None, "") else uuid4()
    existing = session.get(CareOrder, order_id)
    if existing is not None:
        if existing.doctor_id != doctor_id or existing.subject_id != subject_id:
            raise ContractError("conflict", "order_conflict")
        return _order_card(session, existing)
    kind = body.get("kind")
    title = body.get("title")
    instructions = body.get("instructions")
    schedule_text = body.get("schedule_text") or ""
    if kind not in CARE_KINDS:
        raise ContractError("validation_error", "kind")
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
        raise ContractError("validation_error", "title")
    if not isinstance(instructions, str) or not 1 <= len(instructions.strip()) <= 3000:
        raise ContractError("validation_error", "instructions")
    if not isinstance(schedule_text, str) or len(schedule_text) > 500:
        raise ContractError("validation_error", "schedule_text")
    due_at = None
    if body.get("due_at") not in (None, ""):
        due_at = require_due_timestamp(body["due_at"], "due_at")
    now = datetime.now(timezone.utc)
    order = CareOrder(
        id=order_id,
        mission_id=mission_id,
        subject_id=subject_id,
        assignment_id=assignment.id,
        doctor_id=doctor_id,
        kind=kind,
        title=title.strip(),
        instructions=instructions.strip(),
        schedule_text=schedule_text.strip(),
        due_at=due_at,
        status="active",
        revision_no=1,
        parent_order_id=None,
        cancelled_reason=None,
        revise_reason=None,
        ack_required=False,
        acknowledged_at=None,
        schema_version=1,
        created_at=now,
        updated_at=now,
    )
    session.add(order)
    _event(session, order, "created", doctor_id, None)
    _audit(session, doctor_id, "care_order_created", order.id)
    _changelog(session, subject_id, doctor_id, order.id)
    session.commit()
    return _order_card(session, order)


def revise_order(session: Session, doctor_id: UUID, order_id: UUID, body: dict[str, Any]) -> dict[str, object]:
    order = _doctor_order(session, doctor_id, order_id)
    if order.status != "active":
        raise ContractError("validation_error", "order_not_active")
    reason = body.get("reason")
    if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 500:
        raise ContractError("validation_error", "reason")
    title = body.get("title", order.title)
    instructions = body.get("instructions", order.instructions)
    schedule_text = body.get("schedule_text", order.schedule_text)
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
        raise ContractError("validation_error", "title")
    if not isinstance(instructions, str) or not 1 <= len(instructions.strip()) <= 3000:
        raise ContractError("validation_error", "instructions")
    if not isinstance(schedule_text, str) or len(schedule_text) > 500:
        raise ContractError("validation_error", "schedule_text")
    due_at = order.due_at
    if "due_at" in body:
        due_at = None if body.get("due_at") in (None, "") else require_due_timestamp(body["due_at"], "due_at")
    now = datetime.now(timezone.utc)
    order.title = title.strip()
    order.instructions = instructions.strip()
    order.schedule_text = schedule_text.strip()
    order.due_at = due_at
    order.revision_no += 1
    order.revise_reason = reason.strip()
    order.ack_required = True
    order.acknowledged_at = None
    order.updated_at = now
    _event(session, order, "revised", doctor_id, reason.strip())
    _audit(session, doctor_id, "care_order_revised", order.id)
    _changelog(session, order.subject_id, doctor_id, order.id)
    session.commit()
    return _order_card(session, order)


def cancel_order(session: Session, doctor_id: UUID, order_id: UUID, body: dict[str, Any]) -> dict[str, object]:
    order = _doctor_order(session, doctor_id, order_id)
    if order.status == "cancelled":
        return _order_card(session, order)
    reason = body.get("reason")
    if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 500:
        raise ContractError("validation_error", "reason")
    now = datetime.now(timezone.utc)
    order.status = "cancelled"
    order.cancelled_reason = reason.strip()
    order.ack_required = True
    order.acknowledged_at = None
    order.updated_at = now
    _event(session, order, "cancelled", doctor_id, reason.strip())
    _audit(session, doctor_id, "care_order_cancelled", order.id)
    _changelog(session, order.subject_id, doctor_id, order.id)
    session.commit()
    return _order_card(session, order)


def apply_care_order_response_with_hash(
    session: Session, actor_id: UUID, payload: dict[str, Any], operation_id: UUID, payload_hash: str
) -> dict[str, object]:
    order_id = require_uuid(payload.get("order_id"), "order_id")
    decision = payload.get("decision")
    note = payload.get("note")
    if decision not in CARE_DECISIONS:
        raise ContractError("validation_error", "decision")
    if note is not None and (not isinstance(note, str) or not 1 <= len(note) <= 1000):
        raise ContractError("validation_error", "note")
    recorded_at = require_timestamp(payload.get("recorded_at"), "recorded_at")
    created_at_device = require_timestamp(payload.get("created_at_device"), "created_at_device")
    response_id = require_uuid(payload.get("id"), "id")
    order = session.get(CareOrder, order_id)
    if order is None or order.subject_id != actor_id:
        raise ContractError("forbidden", "order_not_owned")
    if not is_active_astronaut(session, actor_id, order.mission_id):
        raise ContractError("forbidden", "not_astronaut")
    existing = session.scalar(select(CareOrderResponse).where(CareOrderResponse.id == response_id))
    if existing is not None:
        if existing.subject_id != actor_id or existing.order_id != order_id or existing.decision != decision:
            raise ContractError("conflict", "response_conflict")
        return {"order_id": str(order.id), "response_id": str(response_id), "decision": decision}
    if decision == "acknowledged":
        order.ack_required = False
        order.acknowledged_at = recorded_at
        order.updated_at = datetime.now(timezone.utc)
        _event(session, order, "acknowledged", actor_id, None)
    elif decision == "done":
        if order.status != "active":
            raise ContractError("validation_error", "order_not_active")
        order.status = "completed"
        order.updated_at = datetime.now(timezone.utc)
        _event(session, order, "completed_by_crew", actor_id, note if isinstance(note, str) else None)
    else:
        if order.status != "active":
            raise ContractError("validation_error", "order_not_active")
        order.status = "completed"
        order.updated_at = datetime.now(timezone.utc)
        _event(session, order, "skipped_by_crew", actor_id, note if isinstance(note, str) else None)
    session.add(
        CareOrderResponse(
            id=response_id,
            order_id=order.id,
            subject_id=order.subject_id,
            mission_id=order.mission_id,
            decision=decision,
            note=None if note in (None, "") else note,
            recorded_at=recorded_at,
            created_at_device=created_at_device,
            operation_id=operation_id,
            payload_hash=payload_hash,
        )
    )
    _changelog(session, order.doctor_id, actor_id, order.id)
    return {"order_id": str(order.id), "response_id": str(response_id), "decision": decision}


def validate_care_order_response(payload: dict[str, Any]) -> None:
    require_uuid(payload.get("id"), "id")
    require_uuid(payload.get("order_id"), "order_id")
    if payload.get("decision") not in CARE_DECISIONS:
        raise ContractError("validation_error", "decision")
    note = payload.get("note")
    if note is not None and (not isinstance(note, str) or not 1 <= len(note) <= 1000):
        raise ContractError("validation_error", "note")
    require_timestamp(payload.get("recorded_at"), "recorded_at")
    require_timestamp(payload.get("created_at_device"), "created_at_device")
    mission_id = optional_uuid(payload.get("mission_id"), "mission_id")
    if mission_id is None:
        raise ContractError("validation_error", "mission_id")


def _order_card(session: Session, order: CareOrder) -> dict[str, object]:
    events = session.scalars(
        select(CareOrderEvent).where(CareOrderEvent.order_id == order.id).order_by(CareOrderEvent.server_at)
    ).all()
    responses = session.scalars(
        select(CareOrderResponse)
        .where(CareOrderResponse.order_id == order.id)
        .order_by(CareOrderResponse.created_at_server.desc())
    ).all()
    return {
        "id": str(order.id),
        "mission_id": str(order.mission_id),
        "subject_id": str(order.subject_id),
        "assignment_id": str(order.assignment_id),
        "doctor_id": str(order.doctor_id),
        "kind": order.kind,
        "title": order.title,
        "instructions": order.instructions,
        "schedule_text": order.schedule_text,
        "due_at": None if order.due_at is None else order.due_at.isoformat(),
        "status": order.status,
        "revision_no": order.revision_no,
        "cancelled_reason": order.cancelled_reason,
        "revise_reason": order.revise_reason,
        "ack_required": order.ack_required,
        "acknowledged_at": None if order.acknowledged_at is None else order.acknowledged_at.isoformat(),
        "created_at": order.created_at.isoformat(),
        "updated_at": order.updated_at.isoformat(),
        "prototype_limit": "observation_task_not_prescription",
        "events": [
            {
                "event_type": event.event_type,
                "actor_id": str(event.actor_id),
                "detail": event.detail,
                "server_at": event.server_at.isoformat(),
            }
            for event in events
        ],
        "responses": [
            {
                "id": str(row.id),
                "decision": row.decision,
                "note": row.note,
                "recorded_at": row.recorded_at.isoformat(),
            }
            for row in responses
        ],
    }


def _active_assignment(session: Session, doctor_id: UUID, mission_id: UUID, subject_id: UUID) -> MedicalAssignment:
    assignment = session.scalar(
        select(MedicalAssignment).where(
            MedicalAssignment.doctor_id == doctor_id,
            MedicalAssignment.patient_id == subject_id,
            MedicalAssignment.mission_id == mission_id,
            *active_assignment_filters(),
        )
    )
    if assignment is None:
        raise PermissionError
    membership = session.scalar(
        select(MissionMembership.id).where(
            MissionMembership.user_id == doctor_id,
            MissionMembership.mission_id == mission_id,
            MissionMembership.role == "doctor",
        )
    )
    if membership is None:
        raise PermissionError
    return assignment


def _doctor_order(session: Session, doctor_id: UUID, order_id: UUID) -> CareOrder:
    order = session.get(CareOrder, order_id)
    if order is None:
        raise LookupError
    if order.doctor_id != doctor_id:
        raise PermissionError
    _active_assignment(session, doctor_id, order.mission_id, order.subject_id)
    return order


def _event(session: Session, order: CareOrder, event_type: str, actor_id: UUID, detail: str | None) -> None:
    session.add(
        CareOrderEvent(
            id=uuid4(),
            order_id=order.id,
            subject_id=order.subject_id,
            mission_id=order.mission_id,
            event_type=event_type,
            actor_id=actor_id,
            detail=detail,
        )
    )


def _audit(session: Session, actor_id: UUID, action: str, entity_id: UUID) -> None:
    session.add(
        AuditEvent(
            id=uuid4(),
            actor_id=actor_id,
            action=action,
            entity_type="care_order",
            entity_id=entity_id,
            request_id=request_id_var.get() or uuid4(),
        )
    )


def _changelog(session: Session, scope_user: UUID, actor_id: UUID, order_id: UUID) -> None:
    session.add(
        ChangeLog(
            scope=str(scope_user),
            entity_type="care_order",
            entity_id=order_id,
            actor_id=actor_id,
        )
    )

