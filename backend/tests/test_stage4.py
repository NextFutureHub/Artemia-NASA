"""Stage 4 acceptance: A12 and A30–A35. A13–A18 stay in test_access.py."""

from uuid import UUID, uuid4

from sqlalchemy import text

from app.canonical import hash_operation, hash_payload_part
from app.db import SessionLocal
from app.models import CheckinPersonalRevision, CheckinRevision, DoctorMessage, Report, ReportEvent, ReportPersonalPart
from tests.payloads import ASSIGNMENT_MIRA, MISSION_ID, RECORDED_AT, checkin_bundle, skipped_personal
from tests.support import auth, count_rows, login, seed_people

CHECKIN_ID = UUID("10000000-0000-4000-8000-000000000201")
REVISION_ID = UUID("10000000-0000-4000-8000-000000000202")
MESSAGE = "Отчёт получил. Уточните, когда началось изменение самочувствия."


def test_a12_omitted_personal_part_is_absent_on_the_server(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    payload = checkin_bundle(CHECKIN_ID, REVISION_ID)
    assert payload["personal"] is None
    accepted = _post(client, mira, "checkin_bundle", payload, uuid4())
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["entity_refs"]["personal_revision_id"] is None
    assert count_rows(CheckinPersonalRevision) == 0
    general = client.get(f"/missions/{MISSION_ID}/checkins/{CHECKIN_ID}", headers=auth(doctor))
    assert general.status_code == 200
    assert "bleeding_category" not in general.text
    assert "personal_payload" not in general.text
    hidden = client.get(f"/missions/{MISSION_ID}/checkins/{CHECKIN_ID}/personal", headers=auth(doctor))
    assert hidden.status_code == 403


def test_a30_preview_snapshot_is_what_the_server_stores(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    _post(client, mira, "checkin_bundle", checkin_bundle(CHECKIN_ID, REVISION_ID), uuid4())
    report_id = uuid4()
    snapshot = _snapshot([str(REVISION_ID)])
    accepted = _post(client, mira, "report_bundle", _report(report_id, snapshot), uuid4())
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["entity_refs"]["personal_included"] is False
    stored = client.get(f"/missions/{MISSION_ID}/reports/{report_id}", headers=auth(mira))
    assert stored.status_code == 200, stored.text
    body = stored.json()
    assert body["general_snapshot"] == snapshot
    assert body["general_hash"] == hash_payload_part(snapshot)
    assert body["integrity"] == "match"
    assert "bleeding_category" not in stored.text
    assert count_rows(ReportPersonalPart) == 0
    visible = client.get(f"/missions/{MISSION_ID}/reports/{report_id}", headers=auth(doctor))
    assert visible.json()["general_snapshot"] == snapshot


def test_a31_accepted_report_is_not_opened(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    _post(client, mira, "checkin_bundle", checkin_bundle(CHECKIN_ID, REVISION_ID), uuid4())
    report_id = uuid4()
    _post(client, mira, "report_bundle", _report(report_id, _snapshot([str(REVISION_ID)])), uuid4())
    card = client.get(f"/missions/{MISSION_ID}/reports/{report_id}", headers=auth(doctor))
    assert card.status_code == 200, card.text
    assert card.json()["doctor_work"] == "not_opened"
    assert [event["event_type"] for event in card.json()["events"]] == ["accepted"]
    inbox = client.get("/ground/inbox", headers=auth(doctor))
    assert inbox.status_code == 200, inbox.text
    item = inbox.json()["items"][0]
    assert item["doctor_work"] == "not_opened"
    assert item["report_id"] == str(report_id)
    assert "personal_snapshot" not in inbox.text
    assert client.post(f"/missions/{MISSION_ID}/reports/{report_id}/opened", headers=auth(mira), json={"role": "doctor"}).status_code == 403
    assert count_rows(ReportEvent) == 1


def test_a32_open_and_reply_are_separate_events(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    _post(client, mira, "checkin_bundle", checkin_bundle(CHECKIN_ID, REVISION_ID), uuid4())
    report_id = uuid4()
    _post(client, mira, "report_bundle", _report(report_id, _snapshot([str(REVISION_ID)])), uuid4())
    opened = client.post(f"/missions/{MISSION_ID}/reports/{report_id}/opened", headers=auth(doctor), json={})
    assert opened.status_code == 200, opened.text
    again = client.post(f"/missions/{MISSION_ID}/reports/{report_id}/opened", headers=auth(doctor), json={})
    assert again.json()["created"] is False
    message_id = uuid4()
    reply = client.post(
        f"/missions/{MISSION_ID}/reports/{report_id}/messages",
        headers=auth(doctor),
        json={
            "id": str(message_id),
            "message_type": "clarifying_question",
            "text": MESSAGE,
            "sensitive": False,
            "supersedes_id": None,
            "role": "doctor",
        },
    )
    assert reply.status_code == 200, reply.text
    card = client.get(f"/missions/{MISSION_ID}/reports/{report_id}", headers=auth(doctor)).json()
    kinds = [event["event_type"] for event in card["events"]]
    assert kinds == ["accepted", "opened", "replied"]
    assert card["doctor_work"] == "replied"
    assert card["messages"][0]["text"] == MESSAGE
    assert card["messages"][0]["sensitive"] is False
    assert count_rows(DoctorMessage) == 1
    session = SessionLocal()
    try:
        audit = " ".join(session.execute(text("select row_to_json(audit_events)::text from audit_events")).scalars())
    finally:
        session.close()
    assert MESSAGE not in audit
    assert client.get("/ground/inbox", headers=auth(mira)).status_code == 403


def test_a33_online_revoke_blocks_the_next_personal_read(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    consent_id = uuid4()
    granted = _post(
        client,
        mira,
        "consent_change",
        {
            "id": str(consent_id),
            "mission_id": str(MISSION_ID),
            "scope": "personal_sharing",
            "decision": "granted",
            "assignment_id": str(ASSIGNMENT_MIRA),
            "supersedes_id": None,
            "recorded_at": RECORDED_AT,
            "created_at_device": RECORDED_AT,
        },
        uuid4(),
    )
    assert granted.status_code == 200, granted.text
    bundle = checkin_bundle(CHECKIN_ID, REVISION_ID)
    bundle["personal"] = {
        "id": str(uuid4()),
        "personal_payload": skipped_personal(),
        "consent_event_id": str(consent_id),
    }
    assert _post(client, mira, "checkin_bundle", bundle, uuid4()).status_code == 200
    assert client.get(f"/missions/{MISSION_ID}/checkins/{CHECKIN_ID}/personal", headers=auth(doctor)).status_code == 200
    revoke_id = uuid4()
    revoked = _post(
        client,
        mira,
        "consent_change",
        {
            "id": str(revoke_id),
            "mission_id": str(MISSION_ID),
            "scope": "personal_sharing",
            "decision": "revoked",
            "assignment_id": str(ASSIGNMENT_MIRA),
            "supersedes_id": str(consent_id),
            "recorded_at": "2026-11-02T08:00:00.000Z",
            "created_at_device": "2026-11-02T08:00:00.000Z",
        },
        uuid4(),
    )
    assert revoked.status_code == 200, revoked.text
    denied = client.get(f"/missions/{MISSION_ID}/checkins/{CHECKIN_ID}/personal", headers=auth(doctor))
    assert denied.status_code == 403
    general = client.get(f"/missions/{MISSION_ID}/checkins/{CHECKIN_ID}", headers=auth(doctor))
    assert general.status_code == 200
    assert "bleeding_category" not in general.text
    sensitive = client.post(
        f"/missions/{MISSION_ID}/reports/{uuid4()}/messages",
        headers=auth(doctor),
        json={"id": str(uuid4()), "message_type": "comment", "text": "скрытый текст", "sensitive": True},
    )
    assert sensitive.status_code in (403, 404)


def test_a35_a_new_revision_does_not_change_the_old_report(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    _post(client, mira, "checkin_bundle", checkin_bundle(CHECKIN_ID, REVISION_ID), uuid4())
    report_id = uuid4()
    snapshot = _snapshot([str(REVISION_ID)])
    assert _post(client, mira, "report_bundle", _report(report_id, snapshot), uuid4()).status_code == 200
    second_id = uuid4()
    correction = checkin_bundle(CHECKIN_ID, second_id, comment="Уточнение")
    correction["revision"]["revision_no"] = 2
    correction["revision"]["parent_revision_id"] = str(REVISION_ID)
    correction["revision"]["reason"] = "уточнение самочувствия"
    corrected = _post(client, mira, "checkin_bundle", correction, uuid4())
    assert corrected.status_code == 200, corrected.text
    assert count_rows(CheckinRevision) == 2
    stored = client.get(f"/missions/{MISSION_ID}/reports/{report_id}", headers=auth(mira)).json()
    assert stored["general_snapshot"] == snapshot
    assert stored["general_snapshot"]["revision_ids"] == [str(REVISION_ID)]
    session = SessionLocal()
    try:
        report = session.get(Report, report_id)
        assert report is not None
        assert report.general_hash == hash_payload_part(snapshot)
    finally:
        session.close()


def _snapshot(revision_ids: list[str]) -> dict:
    return {
        "schema_version": 1,
        "revision_ids": revision_ids,
        "measurements": [],
        "explanatory_rule_versions": [],
        "prepared_at": RECORDED_AT,
        "message": None,
        "recipient_assignment_id": str(ASSIGNMENT_MIRA),
        "summary": "За период заполнено 1 записей. Запрос просмотра: нет. Прикреплено 0 измерений, из них 0 с неизвестным качеством.",
    }


def _report(report_id: UUID, snapshot: dict) -> dict:
    return {
        "report": {
            "id": str(report_id),
            "mission_id": str(MISSION_ID),
            "recipient_assignment_id": str(ASSIGNMENT_MIRA),
            "title": "Самочувствие · 2026-11-01",
            "range_start": "2026-11-01",
            "range_end": "2026-11-01",
            "reason": "planned",
            "general_snapshot": snapshot,
            "message": None,
            "parent_report_id": None,
            "device_id": "device-1",
            "recorded_at": RECORDED_AT,
            "created_at_device": RECORDED_AT,
        },
        "personal": None,
    }


def _post(client, token: str, operation_type: str, payload: dict, operation_id: UUID):
    return client.post(
        "/operations",
        json={
            "operation_id": str(operation_id),
            "type": operation_type,
            "schema_version": 1,
            "payload": payload,
            "hash": hash_operation(1, operation_type, payload),
        },
        headers=auth(token),
    )
