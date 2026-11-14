import json
import subprocess
from pathlib import Path

import pytest

from app.canonical import CanonicalError, canonical_json, hash_operation, hash_payload_part

ROOT = Path(__file__).resolve().parents[2]
SAMPLE = {
    "zero": 0,
    "skip": None,
    "note": "Самочувствие café",
    "tags": ["сон", "sleep"],
    "nested": {"b": 1, "a": None},
}
ESCAPED = {"quote": 'say "hi"', "slash": "a\\b", "breakLine": "a\nb", "sep": "line\u2028sep"}


def test_canonical_json_matches_domain_vectors():
    assert canonical_json(SAMPLE) == (
        '{"nested":{"a":null,"b":1},"note":"Самочувствие café","skip":null,"tags":["сон","sleep"],"zero":0}'
    )
    assert canonical_json({"b": 1, "a": None}) == canonical_json({"a": None, "b": 1})
    assert canonical_json(ESCAPED) == '{"breakLine":"a\\nb","quote":"say \\"hi\\"","sep":"line\u2028sep","slash":"a\\\\b"}'


def test_integral_floats_match_javascript_encoding():
    assert canonical_json({"hours": 7.5, "score": 8.0, "zero": -0.0}) == '{"hours":7.5,"score":8,"zero":0}'


def test_non_finite_numbers_are_rejected():
    with pytest.raises(CanonicalError, match="non_finite_number"):
        canonical_json(float("nan"))


def test_python_hashes_match_the_domain_module():
    probe = ROOT / "tmp_canonical_probe.ts"
    payload_path = ROOT / "tmp_canonical_payload.json"
    probe.write_text(
        "\n".join(
            [
                "import { readFileSync } from 'node:fs'",
                "import { canonicalJson, hashOperation, hashPayloadPart } from './src/domain/canonicalJson.ts'",
                "const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))",
                "const text = canonicalJson(input.sample)",
                "const escapeText = canonicalJson(input.escaped)",
                "const generalText = canonicalJson(input.general)",
                "const hash = await hashOperation({ schemaVersion: 1, type: 'checkin_bundle', payload: input.sample })",
                "const part = await hashPayloadPart(input.general, 1)",
                "process.stdout.write(JSON.stringify({ text, escapeText, generalText, hash, part }))",
                "",
            ]
        ),
        encoding="utf-8",
    )
    payload_path.write_text(
        json.dumps({"sample": SAMPLE, "escaped": ESCAPED, "general": _general()}, ensure_ascii=False),
        encoding="utf-8",
    )
    try:
        completed = subprocess.run(
            ["node", "--experimental-strip-types", str(probe), str(payload_path)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    finally:
        probe.unlink(missing_ok=True)
        payload_path.unlink(missing_ok=True)
    produced = json.loads(completed.stdout)
    assert produced["text"] == canonical_json(SAMPLE)
    assert produced["escapeText"] == canonical_json(ESCAPED)
    assert produced["generalText"] == canonical_json(_general())
    assert produced["hash"] == hash_operation(1, "checkin_bundle", SAMPLE)
    assert produced["part"] == hash_payload_part(_general())
    assert hash_operation(1, "checkin_bundle", SAMPLE) != hash_payload_part(SAMPLE)


def _general():
    return {
        "overall_state": "fair",
        "sleep_hours": 7.5,
        "sleep_answer_status": "answered",
        "comment": "Самочувствие café",
        "review_requested": False,
    }
