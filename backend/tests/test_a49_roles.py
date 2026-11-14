"""A49: commander and admin cannot read medicine. UI for /command and /admin stays P1."""

from uuid import UUID, uuid4

from app.canonical import hash_operation
from tests.payloads import MISSION_ID, RECORDED_AT, checkin_bundle
from tests.support import MIRA, auth, login, seed_people


def test_commander_and_admin_are_denied_medicine_including_care_orders(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    commander = login(client, "commander@demo.artemia.local")
    admin = login(client, "admin@demo.artemia.local")
    mission_id = str(MISSION_ID)
    checkin_id = UUID("10000000-0000-4000-8000-000000000301")
    revision_id = UUID("10000000-0000-4000-8000-000000000302")
    operation_id = UUID("10000000-0000-4000-8000-000000000303")

    assert client.get("/auth/me", headers=auth(commander)).json()["role"] == "commander"
    assert client.get("/auth/me", headers=auth(admin)).json()["role"] == "admin"

    payload = checkin_bundle(checkin_id, revision_id)
    accepted = client.post(
        "/operations",
        headers=auth(mira),
        json={
            "operation_id": str(operation_id),
            "type": "checkin_bundle",
            "schema_version": 1,
            "payload": payload,
            "hash": hash_operation(1, "checkin_bundle", payload),
        },
    )
    assert accepted.status_code == 200, accepted.text

    checkin_path = f"/missions/{mission_id}/checkins/{checkin_id}"
    for token in (commander, admin):
        headers = auth(token)
        assert client.get(checkin_path, headers=headers).status_code == 403
        assert client.get(f"{checkin_path}/personal", headers=headers).status_code == 403
        assert client.get("/ground/inbox", headers=headers).status_code == 403
        assert client.get(f"/ground/crew/{MIRA}?mission_id={mission_id}", headers=headers).status_code == 403
        assert client.get(f"/ground/crew/{MIRA}/orders?mission_id={mission_id}", headers=headers).status_code == 403
        created = client.post(
            f"/ground/crew/{MIRA}/orders?mission_id={mission_id}",
            headers=headers,
            json={
                "kind": "measurement",
                "title": "Should be denied",
                "instructions": "Commander must not create care tasks.",
                "schedule_text": "",
                "due_at": None,
            },
        )
        assert created.status_code == 403
        assert "Самочувствие" not in created.text
        board = client.get("/care-orders", headers=headers)
        assert board.status_code == 200
        assert board.json()["items"] == []
        response_payload = {
            "id": str(uuid4()),
            "order_id": str(uuid4()),
            "mission_id": mission_id,
            "decision": "done",
            "note": None,
            "recorded_at": RECORDED_AT,
            "created_at_device": RECORDED_AT,
        }
        denied_op = client.post(
            "/operations",
            headers=headers,
            json={
                "operation_id": str(uuid4()),
                "type": "care_order_response",
                "schema_version": 1,
                "payload": response_payload,
                "hash": hash_operation(1, "care_order_response", response_payload),
            },
        )
        assert denied_op.status_code == 403
        assert denied_op.json()["status"] == "forbidden"
        assert denied_op.json().get("receipt_id") is None
