import json
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import or_, select
from sqlalchemy.sql import func
from sqlalchemy.orm import Session

from app.access import can_read_general, can_read_personal
from app.config import get_settings
from app.constants import MAX_BODY_BYTES
from app.db import get_db
from app.errors import ContractError, http_status_for
from app.care_orders import cancel_order, create_order, list_board_orders, list_crew_orders, revise_order
from app.ground import crew_card, inbox, mark_opened, post_message, read_personal_report, read_report
from app.models import (
    Account,
    Checkin,
    CheckinPersonalRevision,
    CheckinRevision,
    Measurement,
    MissionMembership,
    Profile,
)
from app.operations import submit_operation
from app.preparation import preparation_bundle
from app.pull import pull_updates
from app.request_context import request_id_var
from app.security import create_token, current_user, verify_password

settings = get_settings()
app = FastAPI(title="Artemia API", version="0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "Cache-Control"],
    allow_credentials=False,
)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request_id = uuid4()
    token = request_id_var.set(request_id)
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["X-Request-ID"] = str(request_id)
    return response


@app.get("/health")
def health(session: Session = Depends(get_db)) -> dict[str, str]:
    session.execute(select(1))
    return {"status": "ok"}


@app.post("/auth/login")
async def login(request: Request, session: Session = Depends(get_db)) -> dict[str, str]:
    try:
        body = await request.json()
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=401, detail="invalid_credentials") from error
    if not isinstance(body, dict):
        raise HTTPException(status_code=401, detail="invalid_credentials")
    email = body.get("email")
    password = body.get("password")
    account = session.scalar(select(Account).where(Account.email == email)) if isinstance(email, str) else None
    password_hash = account.password_hash if account is not None else None
    if not isinstance(password, str) or not verify_password(password, password_hash) or account is None:
        raise HTTPException(status_code=401, detail="invalid_credentials")
    return {"access_token": create_token(account.id), "token_type": "bearer"}


@app.get("/auth/me")
def me(account: Account = Depends(current_user), session: Session = Depends(get_db)) -> dict[str, str]:
    profile = session.get(Profile, account.id)
    if profile is None:
        raise HTTPException(status_code=404, detail="not_found")
    membership = session.scalar(
        select(MissionMembership)
        .where(
            MissionMembership.user_id == account.id,
            MissionMembership.active_from <= func.now(),
            or_(MissionMembership.active_until.is_(None), MissionMembership.active_until > func.now()),
        )
        .order_by(MissionMembership.active_from.desc())
    )
    return {
        "id": str(profile.id),
        "display_name": profile.display_name,
        "callsign": profile.callsign,
        "locale": profile.locale,
        "timezone": profile.timezone,
        "unit_system": getattr(profile, "unit_system", None) or "metric",
        "role": None if membership is None else membership.role,
        "mission_id": None if membership is None else str(membership.mission_id),
    }


@app.get("/preparation")
def preparation(account: Account = Depends(current_user), session: Session = Depends(get_db)) -> dict[str, object]:
    bundle = preparation_bundle(session, account.id)
    if bundle is None:
        raise HTTPException(status_code=403, detail="forbidden")
    return bundle


@app.get("/pull")
def pull(
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
    cursor: str | None = None,
    limit: int = Query(default=100),
) -> dict[str, object]:
    try:
        return pull_updates(session, str(account.id), cursor, limit)
    except ContractError as error:
        raise HTTPException(status_code=http_status_for(error.status), detail=error.code) from error


@app.post("/operations")
async def operations(
    request: Request,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        return _operation_response("validation_error", "payload_too_large")
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        return _operation_response("validation_error", "invalid_json")
    if not isinstance(body, dict):
        return _operation_response("validation_error", "invalid_json")
    result = submit_operation(session, account.id, body)
    return JSONResponse(status_code=http_status_for(result.status), content=result.as_dict())


@app.get("/missions/{mission_id}/checkins/{checkin_id}")
def read_checkin(
    mission_id: UUID,
    checkin_id: UUID,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    checkin = _visible_checkin(session, account.id, mission_id, checkin_id)
    revisions = session.scalars(
        select(CheckinRevision).where(CheckinRevision.checkin_id == checkin.id).order_by(CheckinRevision.revision_no)
    ).all()
    return {
        "id": str(checkin.id),
        "mission_id": str(checkin.mission_id),
        "subject_id": str(checkin.subject_id),
        "local_date": checkin.local_date.isoformat(),
        "timezone": checkin.timezone,
        "type": checkin.type,
        "revisions": [
            {
                "id": str(revision.id),
                "revision_no": revision.revision_no,
                "parent_revision_id": None if revision.parent_revision_id is None else str(revision.parent_revision_id),
                "general_payload": revision.general_payload,
                "reason": revision.reason,
                "payload_hash": revision.payload_hash,
                "schema_version": revision.schema_version,
            }
            for revision in revisions
        ],
    }


@app.get("/missions/{mission_id}/checkins/{checkin_id}/personal")
def read_personal(
    mission_id: UUID,
    checkin_id: UUID,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    checkin = session.get(Checkin, checkin_id)
    if checkin is None or checkin.mission_id != mission_id:
        raise HTTPException(status_code=404, detail="not_found")
    if not can_read_personal(session, account.id, checkin.subject_id, checkin.mission_id):
        raise HTTPException(status_code=403, detail="forbidden")
    parts = session.scalars(
        select(CheckinPersonalRevision)
        .where(CheckinPersonalRevision.subject_id == checkin.subject_id, CheckinPersonalRevision.mission_id == mission_id)
        .join(CheckinRevision, CheckinRevision.id == CheckinPersonalRevision.general_revision_id)
        .where(CheckinRevision.checkin_id == checkin.id)
    ).all()
    if not parts:
        raise HTTPException(status_code=404, detail="not_found")
    return {
        "checkin_id": str(checkin.id),
        "parts": [
            {
                "id": str(part.id),
                "general_revision_id": str(part.general_revision_id),
                "personal_payload": part.personal_payload,
                "payload_hash": part.payload_hash,
            }
            for part in parts
        ],
    }


@app.get("/ground/inbox")
def ground_inbox(account: Account = Depends(current_user), session: Session = Depends(get_db)) -> dict[str, object]:
    body = inbox(session, account.id)
    if body is None:
        raise HTTPException(status_code=403, detail="forbidden")
    return body


@app.get("/ground/crew/{subject_id}")
def ground_crew(
    subject_id: UUID,
    mission_id: UUID,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        card = crew_card(session, account.id, mission_id, subject_id)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail="forbidden") from error
    if card is None:
        raise HTTPException(status_code=404, detail="not_found")
    return card


@app.get("/ground/crew/{subject_id}/orders")
def ground_crew_orders(
    subject_id: UUID,
    mission_id: UUID,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        return list_crew_orders(session, account.id, mission_id, subject_id)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail="forbidden") from error


@app.post("/ground/crew/{subject_id}/orders")
async def ground_create_order(
    subject_id: UUID,
    mission_id: UUID,
    request: Request,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        body = await request.json()
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="invalid_json") from error
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="invalid_json")
    try:
        return create_order(session, account.id, mission_id, subject_id, body)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail="forbidden") from error
    except ContractError as error:
        raise HTTPException(status_code=http_status_for(error.status), detail=error.code) from error


@app.post("/ground/orders/{order_id}/revise")
async def ground_revise_order(
    order_id: UUID,
    request: Request,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        body = await request.json()
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="invalid_json") from error
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="invalid_json")
    try:
        return revise_order(session, account.id, order_id, body)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail="forbidden") from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail="not_found") from error
    except ContractError as error:
        raise HTTPException(status_code=http_status_for(error.status), detail=error.code) from error


@app.post("/ground/orders/{order_id}/cancel")
async def ground_cancel_order(
    order_id: UUID,
    request: Request,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        body = await request.json()
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="invalid_json") from error
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="invalid_json")
    try:
        return cancel_order(session, account.id, order_id, body)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail="forbidden") from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail="not_found") from error
    except ContractError as error:
        raise HTTPException(status_code=http_status_for(error.status), detail=error.code) from error


@app.get("/care-orders")
def board_care_orders(account: Account = Depends(current_user), session: Session = Depends(get_db)) -> dict[str, object]:
    return list_board_orders(session, account.id)


@app.get("/missions/{mission_id}/reports/{report_id}")
def report_card(
    mission_id: UUID,
    report_id: UUID,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        body = read_report(session, account.id, mission_id, report_id)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail="forbidden") from error
    if body is None:
        raise HTTPException(status_code=404, detail="not_found")
    return body


@app.get("/missions/{mission_id}/reports/{report_id}/personal")
def report_personal(
    mission_id: UUID,
    report_id: UUID,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        body = read_personal_report(session, account.id, mission_id, report_id)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail="forbidden") from error
    if body is None:
        raise HTTPException(status_code=404, detail="not_found")
    return body


@app.post("/missions/{mission_id}/reports/{report_id}/opened")
def report_opened(
    mission_id: UUID,
    report_id: UUID,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        return mark_opened(session, account.id, mission_id, report_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail="not_found") from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail="forbidden") from error


@app.post("/missions/{mission_id}/reports/{report_id}/messages")
async def report_message(
    mission_id: UUID,
    report_id: UUID,
    request: Request,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        body = await request.json()
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="invalid_json") from error
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="invalid_json")
    try:
        return post_message(session, account.id, mission_id, report_id, body)
    except LookupError as error:
        raise HTTPException(status_code=404, detail="not_found") from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail="forbidden") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/missions/{mission_id}/measurements/{measurement_id}")
def read_measurement(
    mission_id: UUID,
    measurement_id: UUID,
    account: Account = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    measurement = session.get(Measurement, measurement_id)
    if measurement is None or measurement.mission_id != mission_id:
        raise HTTPException(status_code=404, detail="not_found")
    if not can_read_general(session, account.id, measurement.subject_id, measurement.mission_id):
        raise HTTPException(status_code=403, detail="forbidden")
    value = None if measurement.value is None else float(measurement.value)
    if value is not None and value.is_integer():
        value = int(value)
    return {
        "id": str(measurement.id),
        "mission_id": str(measurement.mission_id),
        "subject_id": str(measurement.subject_id),
        "metric": measurement.metric,
        "value": value,
        "unit": measurement.unit,
        "quality": measurement.quality,
        "source": measurement.source,
    }


def _visible_checkin(session: Session, actor_id: UUID, mission_id: UUID, checkin_id: UUID) -> Checkin:
    checkin = session.get(Checkin, checkin_id)
    if checkin is None or checkin.mission_id != mission_id:
        raise HTTPException(status_code=404, detail="not_found")
    if not can_read_general(session, actor_id, checkin.subject_id, checkin.mission_id):
        raise HTTPException(status_code=403, detail="forbidden")
    return checkin


def _operation_response(status: str, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=http_status_for(status),
        content={
            "status": status,
            "error_code": code,
            "receipt_id": None,
            "payload_hash": None,
            "entity_refs": None,
        },
    )
