"""A fresh demo set leaves the rehearsal rows and does not write a receipt."""

from datetime import datetime, timezone
from uuid import uuid4

from app.canonical import hash_operation
from app.db import SessionLocal
from app.models import Checkin, Mission, Report, ReportEvent, SyncReceipt
from app.seed import ASSIGNMENT_MIRA, DATASET_ID, MISSION_ID, fresh_demo_dataset, seed_demo
from tests.payloads import RECORDED_AT, base_general
from tests.support import auth, count_rows


def test_fresh_dataset_hides_the_rehearsal_without_a_new_receipt(client):
    session = SessionLocal()
    try:
        seed_demo(
            session,
            emails={
                "mira": "mira-01@demo.artemia.local",
                "alex": "alex-02@demo.artemia.local",
                "doctor": "flight-doc@demo.artemia.local",
            },
            passwords={"mira": "mira-demo-pass", "alex": "alex-demo-pass", "doctor": "doctor-demo-pass"},
            start=datetime(2026, 10, 31, tzinfo=timezone.utc),
        )
        session.commit()
    finally:
        session.close()

    mira = _login(client, "mira-01@demo.artemia.local", "mira-demo-pass")
    doctor = _login(client, "flight-doc@demo.artemia.local", "doctor-demo-pass")
    alex = _login(client, "alex-02@demo.artemia.local", "alex-demo-pass")
    checkin_id = uuid4()
    revision_id = uuid4()
    accepted = _post(client, mira, "checkin_bundle", _checkin(checkin_id, revision_id))
    assert accepted.status_code == 200, accepted.text
    report_id = uuid4()
    reported = _post(client, mira, "report_bundle", _report(report_id, revision_id))
    assert reported.status_code == 200, reported.text
    receipts = count_rows(SyncReceipt)
    events = count_rows(ReportEvent)

    denied = client.get(f"/missions/{MISSION_ID}/checkins/{checkin_id}", headers=auth(alex))
    assert denied.status_code == 403

    session = SessionLocal()
    try:
        fresh = fresh_demo_dataset(session)
        session.commit()
        stored_checkin = session.get(Checkin, checkin_id)
        stored_report = session.get(Report, report_id)
        mission = session.get(Mission, MISSION_ID)
        assert stored_checkin is not None
        assert stored_report is not None
        assert stored_checkin.demo_dataset_id == DATASET_ID
        assert stored_report.demo_dataset_id == DATASET_ID
        assert mission is not None
        assert mission.demo_dataset_id == fresh
        assert fresh != DATASET_ID
        seed_demo(
            session,
            emails={
                "mira": "mira-01@demo.artemia.local",
                "alex": "alex-02@demo.artemia.local",
                "doctor": "flight-doc@demo.artemia.local",
            },
            passwords={"mira": "mira-demo-pass", "alex": "alex-demo-pass", "doctor": "doctor-demo-pass"},
            start=datetime(2026, 10, 31, tzinfo=timezone.utc),
        )
        session.commit()
        assert session.get(Mission, MISSION_ID).demo_dataset_id == fresh
        assert stored_checkin.recorded_at.astimezone(timezone.utc).isoformat().startswith("2026-11-01T08:00:00")
    finally:
        session.close()

    assert count_rows(SyncReceipt) == receipts
    assert count_rows(ReportEvent) == events
    history = client.get("/preparation", headers=auth(mira))
    assert history.status_code == 200
    assert history.json()["history"]["checkins"] == []
    inbox = client.get("/ground/inbox", headers=auth(doctor))
    assert inbox.status_code == 200
    assert inbox.json()["items"] == []
    kept = client.get(f"/missions/{MISSION_ID}/checkins/{checkin_id}", headers=auth(mira))
    assert kept.status_code == 200
    assert kept.json()["local_date"] == "2026-11-01"
    assert kept.json()["timezone"] == "UTC"


def _login(client, email: str, password: str) -> str:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _checkin(checkin_id, revision_id):
    return {
        "checkin": {
            "id": str(checkin_id),
            "mission_id": str(MISSION_ID),
            "local_date": "2026-11-01",
            "timezone": "UTC",
            "type": "daily",
            "root_id": str(checkin_id),
            "device_id": "device-1",
            "recorded_at": RECORDED_AT,
            "created_at_device": RECORDED_AT,
            "source": "manual",
            "demo_dataset_id": str(DATASET_ID),
        },
        "revision": {
            "id": str(revision_id),
            "parent_revision_id": None,
            "revision_no": 1,
            "general_payload": base_general(),
            "reason": None,
        },
        "personal": None,
        "measurement_ids": [],
    }


def _report(report_id, revision_id):
    snapshot = {
        "schema_version": 1,
        "revision_ids": [str(revision_id)],
        "measurements": [],
        "explanatory_rule_versions": [{"rule_id": "HISTORY_CHANGE_V1", "version": "1"}],
        "prepared_at": RECORDED_AT,
        "message": None,
        "recipient_assignment_id": str(ASSIGNMENT_MIRA),
        "summary": "Сводка без диагноза",
        "unit_system": "metric",
    }
    return {
        "report": {
            "id": str(report_id),
            "mission_id": str(MISSION_ID),
            "recipient_assignment_id": str(ASSIGNMENT_MIRA),
            "title": "Дневная сводка",
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


def _post(client, token, operation_type, payload):
    return client.post(
        "/operations",
        json={
            "operation_id": str(uuid4()),
            "type": operation_type,
            "schema_version": 1,
            "payload": payload,
            "hash": hash_operation(1, operation_type, payload),
        },
        headers=auth(token),
    )
