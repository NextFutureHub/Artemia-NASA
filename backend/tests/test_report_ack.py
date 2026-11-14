from uuid import uuid4

from app.canonical import hash_operation, hash_payload_part
from tests.payloads import ASSIGNMENT_MIRA, MISSION_ID, RECORDED_AT, checkin_bundle
from tests.support import auth, login, seed_people


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


def _report(report_id, snapshot: dict) -> dict:
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


def _post(client, token, operation_type, payload, operation_id):
    return client.post(
        "/operations",
        headers=auth(token),
        json={
            "operation_id": str(operation_id),
            "type": operation_type,
            "schema_version": 1,
            "payload": payload,
            "hash": hash_operation(1, operation_type, payload),
        },
    )


def test_device_received_and_patient_read_are_separate_idempotent_events(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    alex = login(client, "alex@demo.artemia.local")
    checkin_id = uuid4()
    revision_id = uuid4()
    report_id = uuid4()
    message_id = uuid4()
    snapshot = _snapshot([str(revision_id)])
    # general hash is computed server-side from snapshot inside report; client still sends snapshot
    _post(client, mira, "checkin_bundle", checkin_bundle(checkin_id, revision_id), uuid4())
    created = _post(client, mira, "report_bundle", _report(report_id, snapshot), uuid4())
    assert created.status_code == 200, created.text
    client.post(f"/missions/{MISSION_ID}/reports/{report_id}/opened", headers=auth(doctor), json={})
    reply = client.post(
        f"/missions/{MISSION_ID}/reports/{report_id}/messages",
        headers=auth(doctor),
        json={
            "id": str(message_id),
            "message_type": "clarifying_question",
            "text": "When did it start?",
            "sensitive": False,
            "supersedes_id": None,
        },
    )
    assert reply.status_code == 200, reply.text

    device_payload = {
        "id": str(uuid4()),
        "report_id": str(report_id),
        "mission_id": str(MISSION_ID),
        "ack_type": "device_received",
        "message_id": None,
        "recorded_at": RECORDED_AT,
        "created_at_device": RECORDED_AT,
    }
    first = _post(client, mira, "report_ack", device_payload, uuid4())
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "accepted"
    assert first.json()["entity_refs"]["created"] is True
    again = _post(client, mira, "report_ack", {**device_payload, "id": str(uuid4())}, uuid4())
    assert again.status_code == 200
    assert again.json()["entity_refs"]["created"] is False

    read_payload = {
        "id": str(uuid4()),
        "report_id": str(report_id),
        "mission_id": str(MISSION_ID),
        "ack_type": "patient_read",
        "message_id": str(message_id),
        "recorded_at": RECORDED_AT,
        "created_at_device": RECORDED_AT,
    }
    read = _post(client, mira, "report_ack", read_payload, uuid4())
    assert read.status_code == 200, read.text
    assert read.json()["entity_refs"]["ack_type"] == "patient_read"
    assert read.json()["entity_refs"]["created"] is True
    read_again = _post(client, mira, "report_ack", {**read_payload, "id": str(uuid4())}, uuid4())
    assert read_again.json()["entity_refs"]["created"] is False

    card = client.get(f"/missions/{MISSION_ID}/reports/{report_id}", headers=auth(doctor)).json()
    kinds = [event["event_type"] for event in card["events"]]
    assert kinds == ["accepted", "opened", "replied", "device_received", "patient_read"]
    assert hash_payload_part(snapshot)  # sanity: helper still available

    denied = _post(
        client,
        alex,
        "report_ack",
        {
            "id": str(uuid4()),
            "report_id": str(report_id),
            "mission_id": str(MISSION_ID),
            "ack_type": "patient_read",
            "message_id": str(message_id),
            "recorded_at": RECORDED_AT,
            "created_at_device": RECORDED_AT,
        },
        uuid4(),
    )
    assert denied.status_code == 403
