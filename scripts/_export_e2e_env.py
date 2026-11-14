import json
import os
import urllib.error
import urllib.request

pairs = [
    (os.environ["SEED_MIRA_EMAIL"], os.environ["SEED_MIRA_PASSWORD"], "astronaut"),
    (os.environ["SEED_ALEX_EMAIL"], os.environ["SEED_ALEX_PASSWORD"], "astronaut"),
    (os.environ["SEED_FLIGHT_DOC_EMAIL"], os.environ["SEED_FLIGHT_DOC_PASSWORD"], "doctor"),
]

for email, password, role in pairs:
    req = urllib.request.Request(
        "http://127.0.0.1:8000/auth/login",
        data=json.dumps({"email": email, "password": password, "role": role}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as response:
            print(email.split("@")[0], response.status)
    except urllib.error.HTTPError as err:
        print(email.split("@")[0], err.code)

lines = [
    f"SEED_MIRA_EMAIL={os.environ['SEED_MIRA_EMAIL']}",
    f"SEED_MIRA_PASSWORD={os.environ['SEED_MIRA_PASSWORD']}",
    f"SEED_ALEX_EMAIL={os.environ['SEED_ALEX_EMAIL']}",
    f"SEED_ALEX_PASSWORD={os.environ['SEED_ALEX_PASSWORD']}",
    f"SEED_FLIGHT_DOC_EMAIL={os.environ['SEED_FLIGHT_DOC_EMAIL']}",
    f"SEED_FLIGHT_DOC_PASSWORD={os.environ['SEED_FLIGHT_DOC_PASSWORD']}",
    "VITE_API_URL=http://localhost:8000",
]
with open("/tmp/e2e.env", "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
print("wrote /tmp/e2e.env")
