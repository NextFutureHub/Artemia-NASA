from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.canonical import hash_operation
from tests.payloads import MISSION_ID
from tests.support import MIRA, auth, login, seed_people


def test_doctor_creates_and_crew_responds_while_strangers_are_denied(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")
    alex = login(client, "alex@demo.artemia.local")
    stranger = login(client, "stranger@demo.artemia.local")
    mission_id = str(MISSION_ID)
    order_id = str(uuid4())
    now = datetime.now(timezone.utc)
    due = (now + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    recorded = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    created = client.post(
        f"/ground/crew/{MIRA}/orders?mission_id={mission_id}",
        headers=auth(doctor),
        json={
            "id": order_id,
            "kind": "measurement",
            "title": "Pulse this evening",
            "goal": "Observe resting pulse",
            "instructions": "Enter a resting pulse before sleep.",
            "schedule_text": "Once today",
            "start_at": recorded,
            "review_at": due,
            "due_at": due,
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["kind"] == "measurement"
    assert body["status"] == "active"
    assert body["goal"] == "Observe resting pulse"
    assert body["start_at"] is not None
    assert body["prototype_limit"] == "observation_task_not_prescription"
    assert "medication" not in created.text.lower()

    listed = client.get(f"/ground/crew/{MIRA}/orders?mission_id={mission_id}", headers=auth(doctor))
    assert listed.status_code == 200
    assert listed.json()["items"][0]["id"] == order_id

    denied = client.get(f"/ground/crew/{MIRA}/orders?mission_id={mission_id}", headers=auth(stranger))
    assert denied.status_code == 403

    board = client.get("/care-orders", headers=auth(mira))
    assert board.status_code == 200
    assert board.json()["items"][0]["title"] == "Pulse this evening"
    assert client.get("/care-orders", headers=auth(alex)).json()["items"] == []

    response_id = str(uuid4())
    operation_id = str(uuid4())
    payload = {
        "id": response_id,
        "order_id": order_id,
        "mission_id": mission_id,
        "decision": "done",
        "note": "Entered 68 bpm",
        "link_note": None,
        "activity_id": None,
        "recorded_at": recorded,
        "created_at_device": recorded,
    }
    hashed = hash_operation(1, "care_order_response", payload)
    accepted = client.post(
        "/operations",
        headers=auth(mira),
        json={
            "operation_id": operation_id,
            "type": "care_order_response",
            "schema_version": 1,
            "payload": payload,
            "hash": hashed,
        },
    )
    assert accepted.status_code == 200, accepted.text
    again = client.post(
        "/operations",
        headers=auth(mira),
        json={
            "operation_id": operation_id,
            "type": "care_order_response",
            "schema_version": 1,
            "payload": payload,
            "hash": hashed,
        },
    )
    assert again.status_code == 200
    assert again.json()["receipt_id"] == accepted.json()["receipt_id"]

    foreign_payload = {
        "id": str(uuid4()),
        "order_id": order_id,
        "mission_id": mission_id,
        "decision": "done",
        "note": None,
        "link_note": None,
        "activity_id": None,
        "recorded_at": recorded,
        "created_at_device": recorded,
    }
    foreign = client.post(
        "/operations",
        headers=auth(alex),
        json={
            "operation_id": str(uuid4()),
            "type": "care_order_response",
            "schema_version": 1,
            "payload": foreign_payload,
            "hash": hash_operation(1, "care_order_response", foreign_payload),
        },
    )
    assert foreign.status_code in (403, 422)

    # Order already completed by crew — revise must stay blocked.
    revised_completed = client.post(
        f"/ground/orders/{order_id}/revise",
        headers=auth(doctor),
        json={
            "reason": "Clarify rest context",
            "title": "Pulse this evening",
            "instructions": "Enter a resting pulse after 5 minutes sitting.",
            "schedule_text": "Once today",
            "due_at": due,
        },
    )
    assert revised_completed.status_code == 422

    second_id = str(uuid4())
    second = client.post(
        f"/ground/crew/{MIRA}/orders?mission_id={mission_id}",
        headers=auth(doctor),
        json={
            "id": second_id,
            "kind": "follow_up",
            "title": "Short check-in",
            "instructions": "Write how sleep felt after the measurement.",
            "schedule_text": "Tomorrow morning",
            "start_at": recorded,
        },
    )
    assert second.status_code == 200, second.text
    cancelled = client.post(
        f"/ground/orders/{second_id}/cancel",
        headers=auth(doctor),
        json={"reason": "No longer needed for the demo"},
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["ack_required"] is True


def test_doctor_revise_updates_goal_start_and_review(client):
    seed_people()
    doctor = login(client, "doctor@demo.artemia.local")
    mission_id = str(MISSION_ID)
    order_id = str(uuid4())
    now = datetime.now(timezone.utc)
    start = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    review = (now + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    new_start = (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    new_review = (now + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    created = client.post(
        f"/ground/crew/{MIRA}/orders?mission_id={mission_id}",
        headers=auth(doctor),
        json={
            "id": order_id,
            "kind": "recommendation",
            "title": "Hydration note",
            "goal": "Initial goal",
            "instructions": "Drink water with meals.",
            "schedule_text": "Daily",
            "start_at": start,
            "review_at": review,
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["goal"] == "Initial goal"
    assert created.json()["revision_no"] == 1

    revised = client.post(
        f"/ground/orders/{order_id}/revise",
        headers=auth(doctor),
        json={
            "reason": "Adjust observation window",
            "title": "Hydration note",
            "goal": "Updated hydration goal",
            "instructions": "Drink water with meals and after EVA.",
            "schedule_text": "Daily",
            "start_at": new_start,
            "review_at": new_review,
        },
    )
    assert revised.status_code == 200, revised.text
    body = revised.json()
    assert body["revision_no"] == 2
    assert body["goal"] == "Updated hydration goal"
    assert body["start_at"].startswith(new_start[:19])
    assert body["review_at"].startswith(new_review[:19])
    assert body["revise_reason"] == "Adjust observation window"
    assert body["ack_required"] is True
