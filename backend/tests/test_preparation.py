from uuid import UUID

from app.canonical import hash_operation
from tests.payloads import checkin_bundle
from tests.support import auth, login, seed_people

CHECKIN_ID = UUID("10000000-0000-4000-8000-000000000301")
REVISION_ID = UUID("10000000-0000-4000-8000-000000000302")
OPERATION_ID = UUID("10000000-0000-4000-8000-000000000303")


def test_astronaut_receives_own_bundle_and_others_do_not(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    alex = login(client, "alex@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")

    own = client.get("/preparation", headers=auth(mira))
    assert own.status_code == 200, own.text
    body = own.json()
    assert body["schema_version"] == 1
    assert body["role"] == "astronaut"
    assert body["profile"]["callsign"] == "Mira-01"
    assert body["mission"]["code"] == "ORBIT-DEMO-01"
    assert body["assignment"]["doctor_callsign"] == "Flight-Doc"
    assert body["history"]["checkins"] == []
    assert any(item["id"] == "NASA-HRR" for item in body["sources"])
    assert any(item["rule_id"] == "DATA_NO_CURRENT_V1" for item in body["rules"])
    assert "personal_payload" not in own.text

    payload = checkin_bundle(CHECKIN_ID, REVISION_ID)
    accepted = client.post(
        "/operations",
        headers=auth(mira),
        json={
            "operation_id": str(OPERATION_ID),
            "type": "checkin_bundle",
            "schema_version": 1,
            "payload": payload,
            "hash": hash_operation(1, "checkin_bundle", payload),
        },
    )
    assert accepted.status_code == 200, accepted.text

    loaded = client.get("/preparation", headers=auth(mira))
    assert loaded.status_code == 200
    checkins = loaded.json()["history"]["checkins"]
    assert [item["id"] for item in checkins] == [str(CHECKIN_ID)]
    assert checkins[0]["revisions"][0]["general_payload"]["overall_state"] == "fair"
    assert "personal_payload" not in loaded.text
    assert "bleeding" not in loaded.text

    other = client.get("/preparation", headers=auth(alex))
    assert other.status_code == 200
    assert other.json()["history"]["checkins"] == []
    assert "Самочувствие" not in other.text
    assert str(CHECKIN_ID) not in other.text

    denied = client.get("/preparation", headers=auth(doctor))
    assert denied.status_code == 403
    assert denied.json() == {"detail": "forbidden"}
    assert "Самочувствие" not in denied.text
