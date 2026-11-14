from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "backend" / "app"


def test_api_sources_do_not_log_secrets_or_medical_text():
    text = "\n".join(path.read_text(encoding="utf-8") for path in APP.rglob("*.py"))
    assert "service_role" not in text
    assert "SUPABASE_SERVICE" not in text
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("print(") and "logger." not in stripped:
            continue
        assert "comment" not in stripped
        assert "password" not in stripped
        assert "access_token" not in stripped
        assert "general_payload" not in stripped
