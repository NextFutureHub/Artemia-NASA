from tests.support import auth, login, seed_people


def test_a01_astronaut_and_doctor_receive_different_allowed_routes(client):
    seed_people()
    mira = login(client, "mira@demo.artemia.local")
    doctor = login(client, "doctor@demo.artemia.local")

    mira_me = client.get("/auth/me", headers=auth(mira))
    doctor_me = client.get("/auth/me", headers=auth(doctor))
    assert mira_me.status_code == 200
    assert doctor_me.status_code == 200
    assert mira_me.json()["role"] == "astronaut"
    assert doctor_me.json()["role"] == "doctor"

    preparation = client.get("/preparation", headers=auth(mira))
    assert preparation.status_code == 200, preparation.text
    assert preparation.json()["role"] == "astronaut"
    assert preparation.json()["profile"]["callsign"] == "Mira-01"
    assert client.get("/preparation", headers=auth(doctor)).status_code == 403

    inbox = client.get("/ground/inbox", headers=auth(doctor))
    assert inbox.status_code == 200, inbox.text
    assert client.get("/ground/inbox", headers=auth(mira)).status_code == 403


def test_a02_first_preparation_without_a_session_stays_blocked(client):
    offline = client.get("/preparation")
    assert offline.status_code == 401
    assert offline.json()["detail"] in {"unauthorized", "not_authenticated"}
