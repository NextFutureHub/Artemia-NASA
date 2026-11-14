from uuid import UUID

from app.canonical import hash_operation
from tests.payloads import checkin_bundle
from tests.support import auth, login, seed_people

FIRST_CHECKIN = UUID("10000000-0000-4000-8000-000000000311")
FIRST_REVISION = UUID("10000000-0000-4000-8000-000000000312")
FIRST_OPERATION = UUID("10000000-0000-4000-8000-000000000313")
SECOND_CHECKIN = UUID("10000000-0000-4000-8000-000000000314")
SECOND_REVISION = UUID("10000000-0000-4000-8000-000000000315")
SECOND_OPERATION = UUID("10000000-0000-4000-8000-000000000316")


def _post(client, token: str, checkin_id: UUID, revision_id: UUID, operation_id: UUID):
    payload = checkin_bundle(checkin_id, revision_id)
    return client.post(
        "/operations",
        headers=auth(token),
        json={
            "operation_id": str(operation_id),
            "type": "checkin_bundle",
            "schema_version": 1,
            "payload": payload,
            "hash": hash_operation(1, "checkin_bundle", payload),
        },
    )


def test_pull_returns_own_events_in_order_and_hides_them_from_others(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    alex = login(client, "alex@demo.artemia.local")
    first = _post(client, mira, FIRST_CHECKIN, FIRST_REVISION, FIRST_OPERATION)
    second = _post(client, mira, SECOND_CHECKIN, SECOND_REVISION, SECOND_OPERATION)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    page = client.get("/pull", headers=auth(mira), params={"limit": 1})
    assert page.status_code == 200, page.text
    body = page.json()
    assert len(body["events"]) == 1
    assert body["events"][0]["entity_id"] == str(FIRST_OPERATION)
    assert "general_payload" not in page.text
    assert "comment" not in page.text

    rest = client.get("/pull", headers=auth(mira), params={"cursor": body["next_cursor"], "limit": 100})
    assert rest.status_code == 200
    assert [item["entity_id"] for item in rest.json()["events"]] == [str(SECOND_OPERATION)]
    assert int(rest.json()["events"][0]["position"]) > int(body["events"][0]["position"])

    again = client.get("/pull", headers=auth(mira), params={"cursor": rest.json()["next_cursor"]})
    assert again.json()["events"] == []

    foreign = client.get("/pull", headers=auth(alex))
    assert foreign.status_code == 200
    assert foreign.json()["events"] == []
    assert str(FIRST_OPERATION) not in foreign.text
