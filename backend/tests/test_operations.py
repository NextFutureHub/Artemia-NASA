from uuid import UUID, uuid4

from app.canonical import hash_operation, hash_payload_part
from app.models import InvalidationEvent, PersonalPreference, Report, ReportPersonalPart
from tests.payloads import ASSIGNMENT_MIRA, MISSION_ID, RECORDED_AT, base_general, checkin_bundle, skipped_personal
from tests.support import auth, count_rows, login, seed_people


def test_preferences_invalidation_and_report_use_the_allowlist(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    checkin_id = uuid4()
    revision_id = uuid4()
    accepted = _post(client, mira, "checkin_bundle", checkin_bundle(checkin_id, revision_id), uuid4())
    assert accepted.status_code == 200, accepted.text

    preferences = _post(
        client,
        mira,
        "profile_preferences",
        {
            "locale": "en",
            "timezone": "UTC",
            "age": 34,
            "sex_context": "female",
            "reproductive_enabled": True,
            "cycle_context": None,
            "default_sharing": "device_only",
            "unit_system": "us",
        },
        uuid4(),
    )
    assert preferences.status_code == 200, preferences.text
    me = client.get("/auth/me", headers=auth(mira))
    assert me.json()["locale"] == "en"
    assert me.json()["unit_system"] == "us"
    assert "age" not in me.json()
    assert count_rows(PersonalPreference) == 1

    invalidation_id = uuid4()
    invalidated = _post(
        client,
        mira,
        "invalidation",
        {
            "id": str(invalidation_id),
            "mission_id": str(MISSION_ID),
            "target_type": "checkin",
            "target_id": str(checkin_id),
            "reason": "Ошибочная запись",
            "device_id": "device-1",
            "recorded_at": RECORDED_AT,
            "created_at_device": RECORDED_AT,
        },
        uuid4(),
    )
    assert invalidated.status_code == 200, invalidated.text
    stolen = _post(
        client,
        doctor,
        "invalidation",
        {
            "id": str(uuid4()),
            "mission_id": str(MISSION_ID),
            "target_type": "checkin",
            "target_id": str(checkin_id),
            "reason": "Чужая",
            "device_id": "device-1",
            "recorded_at": RECORDED_AT,
            "created_at_device": RECORDED_AT,
        },
        uuid4(),
    )
    assert stolen.status_code == 403
    assert stolen.json()["error_code"] == "not_mission_astronaut"
    assert count_rows(InvalidationEvent) == 1

    report_id = uuid4()
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
    report = _post(
        client,
        mira,
        "report_bundle",
        {
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
        },
        uuid4(),
    )
    assert report.status_code == 200, report.text
    assert report.json()["entity_refs"]["personal_included"] is False
    assert count_rows(Report) == 1
    assert count_rows(ReportPersonalPart) == 0

    from app.db import SessionLocal

    session = SessionLocal()
    try:
        stored = session.get(Report, report_id)
        assert stored is not None
        assert stored.general_hash == hash_payload_part(snapshot)
        assert stored.author_id != doctor_id()
    finally:
        session.close()
    assert base_general()["fatigue_score"] == 0


def test_wrong_hash_and_oversized_body_do_not_write(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    payload = checkin_bundle(uuid4(), uuid4())
    wrong = _post(client, mira, "checkin_bundle", payload, uuid4(), provided_hash="ab" * 32)
    assert wrong.status_code == 422
    assert wrong.json()["error_code"] == "hash_mismatch"
    huge = client.post(
        "/operations",
        content=b"{" + b"a" * 300_000,
        headers={**auth(mira), "content-type": "application/json"},
    )
    assert huge.status_code == 422
    assert huge.json()["error_code"] == "payload_too_large"
    from app.models import Checkin

    assert count_rows(Checkin) == 0


def test_unmet_dependency_is_rejected(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    payload = checkin_bundle(uuid4(), uuid4())
    response = client.post(
        "/operations",
        json={
            "operation_id": str(uuid4()),
            "type": "checkin_bundle",
            "schema_version": 1,
            "payload": payload,
            "hash": hash_operation(1, "checkin_bundle", payload),
            "dependencies": [str(uuid4())],
        },
        headers=auth(mira),
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "unmet_dependency"


def _post(client, token, operation_type, payload, operation_id, provided_hash=None):
    return client.post(
        "/operations",
        json={
            "operation_id": str(operation_id),
            "type": operation_type,
            "schema_version": 1,
            "payload": payload,
            "hash": provided_hash or hash_operation(1, operation_type, payload),
        },
        headers=auth(token),
    )


def doctor_id():
    from tests.support import DOCTOR

    return DOCTOR
