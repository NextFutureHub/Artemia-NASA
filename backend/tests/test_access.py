from uuid import UUID

import jwt

from app.canonical import hash_operation, hash_payload_part
from app.models import AuditEvent, Checkin, CheckinMeasurement, CheckinRevision, Measurement
from tests.conftest import TOKEN_SECRET
from tests.payloads import ASSIGNMENT_MIRA, MISSION_ID, RECORDED_AT, checkin_bundle, measurement_payload, skipped_personal
from tests.support import ALEX, DOCTOR, MIRA, PASSWORD, STRANGER, auth, count_rows, login, seed_people

CHECKIN_ID = UUID("10000000-0000-4000-8000-000000000201")
REVISION_ID = UUID("10000000-0000-4000-8000-000000000202")
OPERATION_ID = UUID("10000000-0000-4000-8000-000000000101")


def test_assigned_doctor_reads_general_part_and_others_are_denied(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    alex = login(client, "alex@demo.artemia.local")
    stranger = login(client, "stranger@demo.artemia.local")
    payload = checkin_bundle(CHECKIN_ID, REVISION_ID)
    accepted = _post(client, mira, "checkin_bundle", payload, OPERATION_ID)

    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["status"] == "accepted"
    assert body["entity_refs"]["revision_id"] == str(REVISION_ID)
    assert count_rows(CheckinRevision) == 1

    general = client.get(_checkin_path(), headers=auth(doctor))
    assert general.status_code == 200, general.text
    revision = general.json()["revisions"][0]
    assert revision["general_payload"]["overall_state"] == "fair"
    assert revision["general_payload"]["fatigue_score"] == 0
    assert revision["general_payload"]["stress_score"] is None
    assert revision["payload_hash"] == hash_payload_part(payload["revision"]["general_payload"])
    assert "personal_payload" not in general.text
    assert "bleeding" not in general.text

    own = client.get(_checkin_path(), headers=auth(mira))
    assert own.status_code == 200

    for token in (alex, stranger):
        denied = client.get(_checkin_path(), headers=auth(token))
        assert denied.status_code == 403
        assert denied.json() == {"detail": "forbidden"}
        assert "Самочувствие" not in denied.text

    personal = client.get(_checkin_path() + "/personal", headers=auth(doctor))
    assert personal.status_code == 403
    assert client.get(_checkin_path() + "/personal", headers=auth(mira)).status_code == 404


def test_role_claim_in_the_token_does_not_change_access(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    _post(client, mira, "checkin_bundle", checkin_bundle(CHECKIN_ID, REVISION_ID), OPERATION_ID)

    forged_doctor = _token(ALEX, role="doctor", user_metadata={"role": "doctor"})
    denied = client.get(_checkin_path(), headers=auth(forged_doctor))
    assert denied.status_code == 403

    login_with_role = client.post(
        "/auth/login",
        json={"email": "alex@demo.artemia.local", "password": PASSWORD, "role": "doctor", "user_metadata": {"role": "doctor"}},
    )
    assert login_with_role.status_code == 200
    assert client.get(_checkin_path(), headers=auth(login_with_role.json()["access_token"])).status_code == 403

    forged_astronaut = _token(DOCTOR, role="astronaut", user_metadata={"role": "astronaut"})
    allowed = client.get(_checkin_path(), headers=auth(forged_astronaut))
    assert allowed.status_code == 200
    assert allowed.json()["revisions"][0]["general_payload"]["overall_state"] == "fair"


def test_direct_api_bypass_does_not_create_a_record(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    before = count_rows(Checkin)
    for method in ("post", "put", "patch"):
        response = getattr(client, method)("/checkins", headers=auth(mira), json={"id": str(CHECKIN_ID)})
        assert response.status_code in (404, 405)
    assert client.delete("/checkins", headers=auth(mira)).status_code in (404, 405)
    for path in ("/sync_receipts", "/private/sync_receipts", "/rest/v1/checkins", "/rpc/submit_operation", "/auth/register"):
        assert client.post(path, headers=auth(mira), json={}).status_code in (404, 405)
    assert count_rows(Checkin) == before

    schema = client.get("/openapi.json").json()
    posts = sorted(path for path, methods in schema["paths"].items() if "post" in methods)
    assert posts == [
        "/auth/login",
        "/missions/{mission_id}/reports/{report_id}/messages",
        "/missions/{mission_id}/reports/{report_id}/opened",
        "/operations",
    ]
    missed = client.post(
        f"/missions/{MISSION_ID}/reports/10000000-0000-4000-8000-000000000099/opened",
        headers=auth(mira),
        json={"role": "doctor"},
    )
    assert missed.status_code in (403, 404)
    assert count_rows(Checkin) == before
    assert all("receipt" not in path for path in schema["paths"])


def test_repeat_returns_the_same_receipt_and_a_different_hash_conflicts(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    payload = checkin_bundle(CHECKIN_ID, REVISION_ID)
    first = _post(client, mira, "checkin_bundle", payload, OPERATION_ID)
    second = _post(client, mira, "checkin_bundle", payload, OPERATION_ID)
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["status"] == "duplicate"
    assert second.json()["receipt_id"] == first.json()["receipt_id"]
    assert second.json()["entity_refs"]["revision_id"] == str(REVISION_ID)
    assert count_rows(CheckinRevision) == 1

    conflict = _post(client, mira, "checkin_bundle", payload, OPERATION_ID, provided_hash="0" * 64)
    assert conflict.status_code == 409
    assert conflict.json()["status"] == "conflict"
    assert conflict.json()["error_code"] == "hash_mismatch"
    assert conflict.json()["entity_refs"] is None
    assert conflict.json()["receipt_id"] is None
    assert count_rows(CheckinRevision) == 1
    assert client.get(_checkin_path(), headers=auth(doctor)).json()["revisions"][0]["general_payload"]["overall_state"] == "fair"


def test_same_operation_from_another_actor_hides_the_receipt(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    alex = login(client, "alex@demo.artemia.local")
    payload = checkin_bundle(CHECKIN_ID, REVISION_ID)
    _post(client, mira, "checkin_bundle", payload, OPERATION_ID)
    conflict = _post(client, alex, "checkin_bundle", payload, OPERATION_ID)
    assert conflict.status_code == 409
    assert conflict.json()["error_code"] == "operation_actor_mismatch"
    assert conflict.json()["entity_refs"] is None
    assert count_rows(Checkin) == 1


def test_foreign_measurement_is_rejected_without_a_link(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    alex = login(client, "alex@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    measurement_id = UUID("10000000-0000-4000-8000-000000000301")
    measured = _post(client, alex, "measurement", measurement_payload(measurement_id), UUID("10000000-0000-4000-8000-000000000104"))
    assert measured.status_code == 200, measured.text
    stolen = checkin_bundle(CHECKIN_ID, REVISION_ID)
    stolen["measurement_ids"] = [str(measurement_id)]
    rejected = _post(client, mira, "checkin_bundle", stolen, UUID("10000000-0000-4000-8000-000000000105"))
    assert rejected.status_code == 403
    assert rejected.json()["error_code"] == "measurement_not_owned"
    assert count_rows(CheckinMeasurement) == 0
    assert count_rows(Checkin) == 0
    visible = client.get(f"/missions/{MISSION_ID}/measurements/{measurement_id}", headers=auth(doctor))
    hidden = client.get(f"/missions/{MISSION_ID}/measurements/{measurement_id}", headers=auth(mira))
    assert visible.status_code == 200
    assert visible.json()["value"] == 72
    assert hidden.status_code == 403


def test_extra_field_and_zero_used_as_skip_are_rejected(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    tainted = checkin_bundle(CHECKIN_ID, REVISION_ID)
    tainted["revision"]["general_payload"]["diagnosis"] = "x"
    rejected = _post(client, mira, "checkin_bundle", tainted, UUID("10000000-0000-4000-8000-000000000102"))
    assert rejected.status_code == 422
    assert rejected.json()["error_code"] == "general_payload_keys"
    skipped = checkin_bundle(
        UUID("10000000-0000-4000-8000-000000000203"),
        UUID("10000000-0000-4000-8000-000000000204"),
        fatigue_score=0,
        fatigue_answer_status="unknown",
    )
    zero = _post(client, mira, "checkin_bundle", skipped, UUID("10000000-0000-4000-8000-000000000103"))
    assert zero.status_code == 422
    assert zero.json()["error_code"] == "fatigue_score_skip_must_be_null"
    assert count_rows(Checkin) == 0


def test_unknown_operation_and_unauthenticated_request_do_not_write(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    unknown = _post(client, mira, "delete_all", {"id": str(CHECKIN_ID)}, UUID("10000000-0000-4000-8000-000000000106"))
    assert unknown.status_code == 422
    assert unknown.json()["error_code"] == "unknown_operation_type"
    anonymous = client.post("/operations", json={"type": "checkin_bundle"})
    assert anonymous.status_code == 401
    assert count_rows(Checkin) == 0
    assert count_rows(AuditEvent) == 0


def test_personal_part_requires_consent_and_stays_separate(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    stranger = login(client, "stranger@demo.artemia.local")
    alex = login(client, "alex@demo.artemia.local")
    consent_id = UUID("10000000-0000-4000-8000-000000000401")
    early = checkin_bundle(CHECKIN_ID, REVISION_ID)
    early["personal"] = {
        "id": str(UUID("10000000-0000-4000-8000-000000000209")),
        "personal_payload": skipped_personal(),
        "consent_event_id": str(consent_id),
    }
    blocked = _post(client, mira, "checkin_bundle", early, UUID("10000000-0000-4000-8000-000000000108"))
    assert blocked.status_code == 403
    assert blocked.json()["error_code"] == "personal_consent"
    assert count_rows(Checkin) == 0

    consent = _post(
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
        UUID("10000000-0000-4000-8000-000000000107"),
    )
    assert consent.status_code == 200, consent.text
    personal_checkin = UUID("10000000-0000-4000-8000-000000000207")
    personal_revision = UUID("10000000-0000-4000-8000-000000000208")
    bundle = checkin_bundle(personal_checkin, personal_revision)
    bundle["personal"] = {
        "id": str(UUID("10000000-0000-4000-8000-000000000210")),
        "personal_payload": skipped_personal(),
        "consent_event_id": str(consent_id),
    }
    accepted = _post(client, mira, "checkin_bundle", bundle, UUID("10000000-0000-4000-8000-000000000109"))
    assert accepted.status_code == 200, accepted.text

    general = client.get(f"/missions/{MISSION_ID}/checkins/{personal_checkin}", headers=auth(doctor))
    assert general.status_code == 200
    assert "bleeding_category" not in general.text
    personal = client.get(f"/missions/{MISSION_ID}/checkins/{personal_checkin}/personal", headers=auth(doctor))
    assert personal.status_code == 200, personal.text
    part = personal.json()["parts"][0]
    assert part["payload_hash"] == hash_payload_part(skipped_personal())
    assert part["payload_hash"] != general.json()["revisions"][0]["payload_hash"]
    assert client.get(f"/missions/{MISSION_ID}/checkins/{personal_checkin}/personal", headers=auth(stranger)).status_code == 403
    assert client.get(f"/missions/{MISSION_ID}/checkins/{personal_checkin}/personal", headers=auth(alex)).status_code == 403


def test_audit_does_not_store_the_comment(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    _post(client, mira, "checkin_bundle", checkin_bundle(CHECKIN_ID, REVISION_ID), OPERATION_ID)
    from sqlalchemy import text

    from app.db import SessionLocal

    session = SessionLocal()
    try:
        rows = session.execute(text("select action, entity_type, entity_id::text from audit_events")).all()
    finally:
        session.close()
    assert rows
    assert "Самочувствие" not in " ".join(" ".join(row) for row in rows)


def _post(client, token: str, operation_type: str, payload: dict, operation_id: UUID, provided_hash: str | None = None):
    digest = provided_hash or hash_operation(1, operation_type, payload)
    return client.post(
        "/operations",
        json={
            "operation_id": str(operation_id),
            "type": operation_type,
            "schema_version": 1,
            "payload": payload,
            "hash": digest,
        },
        headers=auth(token),
    )


def _token(user_id: UUID, **extra) -> str:
    return jwt.encode({"sub": str(user_id), "exp": 4102444800, **extra}, TOKEN_SECRET, algorithm="HS256")


def _checkin_path() -> str:
    return f"/missions/{MISSION_ID}/checkins/{CHECKIN_ID}"
