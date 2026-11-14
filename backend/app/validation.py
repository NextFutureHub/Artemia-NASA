"""Validate a frozen payload. Extra keys are rejected before any row is written."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from app.constants import (
    ANSWER_STATUSES,
    BLEEDING_CATEGORIES,
    BLEEDING_INTENSITIES,
    CHECKIN_TYPES,
    CONSENT_DECISIONS,
    CONSENT_SCOPES,
    CONTEXT_CODES,
    CYCLE_CONTEXTS,
    EMOTIONAL_STATES,
    EXPECTEDNESS_VALUES,
    IMPACT_VALUES,
    INVALIDATION_TARGETS,
    LOCALES,
    MEASUREMENT_CONTEXTS,
    MEASUREMENT_QUALITIES,
    MEASUREMENT_SOURCES,
    METRICS,
    ONSET_CATEGORIES,
    OVERALL_STATES,
    PERSISTENCE_VALUES,
    PLAN_ADHERENCE,
    REPORT_REASONS,
    SEX_CONTEXTS,
    SHARING_MODES,
    SYMPTOM_CODES,
    SYMPTOM_PRESENCE,
)
from app.errors import ContractError

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DEVICE_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
TIMEZONE_RE = re.compile(r"^[A-Za-z0-9_+./-]{1,64}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")

CHECKIN_KEYS = {
    "created_at_device",
    "demo_dataset_id",
    "device_id",
    "id",
    "local_date",
    "mission_id",
    "recorded_at",
    "root_id",
    "source",
    "timezone",
    "type",
}
REVISION_KEYS = {"general_payload", "id", "parent_revision_id", "reason", "revision_no"}
GENERAL_KEYS = {
    "comment",
    "context",
    "emotional_state",
    "fatigue_answer_status",
    "fatigue_score",
    "overall_state",
    "review_requested",
    "sleep_answer_status",
    "sleep_hours",
    "sleep_quality",
    "sleep_quality_answer_status",
    "stress_answer_status",
    "stress_score",
    "symptom_presence",
    "symptoms",
}
SYMPTOM_KEYS = {
    "answer_status",
    "code",
    "comment",
    "custom_label",
    "impact",
    "onset_category",
    "persistence",
    "severity",
}
PERSONAL_KEYS = {
    "activity_impact",
    "activity_impact_answer_status",
    "bleeding_category",
    "bleeding_category_answer_status",
    "bleeding_intensity",
    "bleeding_intensity_answer_status",
    "comment",
    "comment_answer_status",
    "cycle_context",
    "cycle_context_answer_status",
    "discomfort_answer_status",
    "discomfort_score",
    "expectedness",
    "expectedness_answer_status",
    "prescribed_plan_adherence",
    "prescribed_plan_adherence_answer_status",
    "review_requested",
}
MEASUREMENT_KEYS = {
    "algorithm_version",
    "attempt_id",
    "context",
    "created_at_device",
    "demo_dataset_id",
    "device_id",
    "device_metadata",
    "id",
    "metric",
    "mission_id",
    "note",
    "quality",
    "quality_reasons",
    "recorded_at",
    "source",
    "unit",
    "value",
}
REPORT_KEYS = {
    "created_at_device",
    "device_id",
    "general_snapshot",
    "id",
    "message",
    "mission_id",
    "parent_report_id",
    "range_end",
    "range_start",
    "reason",
    "recipient_assignment_id",
    "recorded_at",
    "title",
}
SNAPSHOT_KEYS = {
    "explanatory_rule_versions",
    "measurements",
    "message",
    "prepared_at",
    "recipient_assignment_id",
    "revision_ids",
    "schema_version",
    "summary",
}
SNAPSHOT_MEASUREMENT_KEYS = {"measurement_id", "metric", "quality", "recorded_at", "source", "unit", "value"}
INVALIDATION_KEYS = {
    "created_at_device",
    "device_id",
    "id",
    "mission_id",
    "reason",
    "recorded_at",
    "target_id",
    "target_type",
}
PREFERENCE_KEYS = {
    "age",
    "cycle_context",
    "default_sharing",
    "locale",
    "reproductive_enabled",
    "sex_context",
    "timezone",
}
CONSENT_KEYS = {
    "assignment_id",
    "created_at_device",
    "decision",
    "id",
    "mission_id",
    "recorded_at",
    "scope",
    "supersedes_id",
}
SNAPSHOT_FORBIDDEN = {
    "activity_impact",
    "bleeding_category",
    "bleeding_intensity",
    "cycle_context",
    "discomfort_score",
    "expectedness",
    "personal_payload",
    "personal_snapshot",
    "prescribed_plan_adherence",
}
METADATA_FORBIDDEN = {"bleeding_category", "cycle_context", "personal_payload", "personal_snapshot"}


def fail(code: str) -> None:
    raise ContractError("validation_error", code)


def require_keys(value: object, expected: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        fail(code)
    return value


def require_uuid(value: object, code: str = "identifier") -> UUID:
    if not isinstance(value, str) or UUID_RE.fullmatch(value) is None:
        fail(code)
    return UUID(value)


def optional_uuid(value: object, code: str) -> UUID | None:
    if value is None:
        return None
    return require_uuid(value, code)


def require_timestamp(value: object, code: str) -> datetime:
    if not isinstance(value, str) or TIMESTAMP_RE.fullmatch(value) is None:
        fail(code)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        fail(code)
    if parsed > datetime.now(timezone.utc) + timedelta(minutes=5):
        fail("timestamp_future")
    return parsed


def require_date(value: object, code: str):
    if not isinstance(value, str) or DATE_RE.fullmatch(value) is None:
        fail(code)
    return datetime.strptime(value, "%Y-%m-%d").date()


def is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def status_number(value: object, status: object, low: Decimal, high: Decimal, step: Decimal, field: str) -> None:
    if status not in ANSWER_STATUSES:
        fail(f"{field}_answer_status")
    if status == "answered":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            fail(f"{field}_answered_value")
        number = Decimal(str(value))
        if number < low or number > high:
            fail(f"{field}_range")
        if number % step != 0:
            fail(f"{field}_step")
        return
    if value is not None:
        fail(f"{field}_skip_must_be_null")


def optional_choice(value: object, status: object, allowed: tuple[str, ...], field: str) -> None:
    if status not in ANSWER_STATUSES:
        fail(f"{field}_answer_status")
    if status == "answered":
        if value not in allowed:
            fail(f"{field}_answered_value")
        return
    if value is not None:
        fail(f"{field}_skip_must_be_null")


def optional_comment(value: object, status: object, field: str, limit: int) -> None:
    if status not in ANSWER_STATUSES:
        fail(f"{field}_answer_status")
    if status == "answered":
        if not isinstance(value, str) or not 1 <= len(value) <= limit:
            fail(field)
        return
    if value is not None:
        fail(f"{field}_skip_must_be_null")


def contains_key(value: object, forbidden: set[str], depth: int = 0) -> bool:
    if depth > 20:
        return True
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in forbidden or contains_key(nested, forbidden, depth + 1):
                return True
    elif isinstance(value, list):
        return any(contains_key(item, forbidden, depth + 1) for item in value)
    return False


def validate_symptom(value: object) -> None:
    symptom = require_keys(value, SYMPTOM_KEYS, "symptom_keys")
    if symptom["code"] not in SYMPTOM_CODES:
        fail("symptom_code")
    label = symptom["custom_label"]
    if symptom["code"] == "other":
        if not isinstance(label, str) or not 2 <= len(label) <= 80:
            fail("custom_label")
    elif label is not None:
        fail("custom_label")
    status_number(symptom["severity"], symptom["answer_status"], Decimal(0), Decimal(10), Decimal(1), "severity")
    if symptom["onset_category"] not in ONSET_CATEGORIES:
        fail("onset_category")
    if symptom["persistence"] not in PERSISTENCE_VALUES:
        fail("persistence")
    if symptom["impact"] not in IMPACT_VALUES:
        fail("impact")
    comment = symptom["comment"]
    if comment is None:
        return
    if not isinstance(comment, str) or not 1 <= len(comment) <= 500:
        fail("symptom_comment")


def validate_general_payload(value: object) -> dict[str, Any]:
    payload = require_keys(value, GENERAL_KEYS, "general_payload_keys")
    if payload["overall_state"] not in OVERALL_STATES:
        fail("overall_state")
    status_number(payload["sleep_hours"], payload["sleep_answer_status"], Decimal(0), Decimal(24), Decimal("0.5"), "sleep_hours")
    status_number(
        payload["sleep_quality"], payload["sleep_quality_answer_status"], Decimal(1), Decimal(5), Decimal(1), "sleep_quality"
    )
    status_number(payload["fatigue_score"], payload["fatigue_answer_status"], Decimal(0), Decimal(10), Decimal(1), "fatigue_score")
    status_number(payload["stress_score"], payload["stress_answer_status"], Decimal(0), Decimal(10), Decimal(1), "stress_score")
    emotional = payload["emotional_state"]
    if not isinstance(emotional, dict) or set(emotional) != {"note", "value"}:
        fail("emotional_state")
    if emotional["value"] not in EMOTIONAL_STATES:
        fail("emotional_state")
    note = emotional["note"]
    if note is not None and (not isinstance(note, str) or not 1 <= len(note) <= 120):
        fail("emotional_note")
    if emotional["value"] != "other" and note is not None:
        fail("emotional_note")
    context = payload["context"]
    if not isinstance(context, list) or len(context) > 4:
        fail("context")
    codes: list[str] = []
    for item in context:
        if not isinstance(item, dict) or set(item) != {"code", "custom_label"}:
            fail("context")
        if item["code"] not in CONTEXT_CODES:
            fail("context")
        custom = item["custom_label"]
        if custom is None:
            pass
        elif not isinstance(custom, str) or not 1 <= len(custom) <= 120 or item["code"] != "other":
            fail("context")
        codes.append(item["code"])
    if len(set(codes)) != len(codes):
        fail("context")
    comment = payload["comment"]
    if comment is not None and (not isinstance(comment, str) or not 1 <= len(comment) <= 1000):
        fail("comment")
    if payload["symptom_presence"] not in SYMPTOM_PRESENCE:
        fail("symptom_presence")
    symptoms = payload["symptoms"]
    if not isinstance(symptoms, list) or len(symptoms) > 12:
        fail("symptoms")
    if payload["symptom_presence"] == "yes" and len(symptoms) == 0:
        fail("symptoms_required")
    if payload["symptom_presence"] != "yes" and len(symptoms) != 0:
        fail("symptoms_must_be_empty")
    for symptom in symptoms:
        validate_symptom(symptom)
    if not isinstance(payload["review_requested"], bool):
        fail("review_requested")
    return payload


def validate_personal_payload(value: object) -> dict[str, Any]:
    payload = require_keys(value, PERSONAL_KEYS, "personal_payload_keys")
    optional_choice(
        payload["bleeding_category"], payload["bleeding_category_answer_status"], BLEEDING_CATEGORIES, "bleeding_category"
    )
    optional_choice(payload["expectedness"], payload["expectedness_answer_status"], EXPECTEDNESS_VALUES, "expectedness")
    optional_choice(payload["activity_impact"], payload["activity_impact_answer_status"], IMPACT_VALUES, "activity_impact")
    optional_choice(payload["cycle_context"], payload["cycle_context_answer_status"], CYCLE_CONTEXTS, "cycle_context")
    optional_comment(payload["comment"], payload["comment_answer_status"], "comment", 1000)
    status_number(
        payload["discomfort_score"], payload["discomfort_answer_status"], Decimal(0), Decimal(10), Decimal(1), "discomfort_score"
    )
    intensity_applies = payload["bleeding_category_answer_status"] == "answered" and payload["bleeding_category"] in {
        "spotting",
        "menstrual",
        "other",
    }
    if not intensity_applies:
        if payload["bleeding_intensity"] is not None or payload["bleeding_intensity_answer_status"] != "not_applicable":
            fail("bleeding_intensity")
    else:
        optional_choice(
            payload["bleeding_intensity"],
            payload["bleeding_intensity_answer_status"],
            BLEEDING_INTENSITIES,
            "bleeding_intensity",
        )
        if payload["bleeding_intensity_answer_status"] == "not_applicable":
            fail("bleeding_intensity")
    adherence_applies = (
        payload["cycle_context_answer_status"] == "answered" and payload["cycle_context"] == "suppression_regimen"
    )
    if not adherence_applies:
        if (
            payload["prescribed_plan_adherence"] is not None
            or payload["prescribed_plan_adherence_answer_status"] != "not_applicable"
        ):
            fail("prescribed_plan_adherence")
    else:
        optional_choice(
            payload["prescribed_plan_adherence"],
            payload["prescribed_plan_adherence_answer_status"],
            PLAN_ADHERENCE,
            "prescribed_plan_adherence",
        )
        if payload["prescribed_plan_adherence_answer_status"] == "not_applicable":
            fail("prescribed_plan_adherence")
    if not isinstance(payload["review_requested"], bool):
        fail("review_requested")
    return payload


def measurement_number(metric: str, value: object) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail("measurement_value")
    number = Decimal(str(value))
    if metric == "temperature":
        quantized = number.quantize(Decimal("0.1"))
    else:
        quantized = number.quantize(Decimal("1"))
    if quantized != number:
        fail("measurement_value")
    return quantized


def validate_measurement(value: object) -> dict[str, Any]:
    payload = require_keys(value, MEASUREMENT_KEYS, "measurement_keys")
    require_uuid(payload["id"])
    require_uuid(payload["mission_id"])
    if payload["source"] not in MEASUREMENT_SOURCES or not isinstance(payload["device_id"], str) or DEVICE_RE.fullmatch(payload["device_id"]) is None:
        fail("measurement_fields")
    optional_uuid(payload["demo_dataset_id"], "demo_dataset_id")
    optional_uuid(payload["attempt_id"], "attempt_id")
    require_timestamp(payload["recorded_at"], "recorded_at")
    require_timestamp(payload["created_at_device"], "created_at_device")
    if payload["metric"] not in METRICS or payload["quality"] not in MEASUREMENT_QUALITIES:
        fail("measurement_value")
    if payload["context"] is not None and payload["context"] not in MEASUREMENT_CONTEXTS:
        fail("context")
    note = payload["note"]
    if note is not None and (not isinstance(note, str) or not 1 <= len(note) <= 300):
        fail("note")
    algorithm = payload["algorithm_version"]
    if algorithm is not None and (not isinstance(algorithm, str) or not 1 <= len(algorithm) <= 40):
        fail("algorithm_version")
    metadata = payload["device_metadata"]
    if metadata is not None and (not isinstance(metadata, dict) or contains_key(metadata, METADATA_FORBIDDEN)):
        fail("device_metadata")
    reasons = payload["quality_reasons"]
    if not isinstance(reasons, list) or len(reasons) > 20:
        fail("quality_reasons")
    for reason in reasons:
        if not isinstance(reason, str) or not 1 <= len(reason) <= 80:
            fail("quality_reasons")
    quality = payload["quality"]
    if quality in ("invalid", "insufficient"):
        if payload["value"] is not None:
            fail("measurement_value")
        number = None
    else:
        number = measurement_number(payload["metric"], payload["value"])
        if number is None:
            fail("measurement_value")
    if not _metric_unit_ok(payload["metric"], payload["unit"], number):
        fail("measurement_value")
    return payload


def _metric_unit_ok(metric: object, unit: object, number: Decimal | None) -> bool:
    if metric == "heart_rate":
        return unit == "bpm" and (
            number is None or (number == number.to_integral_value() and Decimal(20) <= number <= Decimal(250))
        )
    if metric == "temperature":
        return unit == "celsius" and (number is None or Decimal(30) <= number <= Decimal(45))
    if metric == "spo2":
        return unit == "percent" and (
            number is None or (number == number.to_integral_value() and Decimal(50) <= number <= Decimal(100))
        )
    return False


def validate_checkin_shape(value: object) -> dict[str, Any]:
    payload = require_keys(value, {"checkin", "measurement_ids", "personal", "revision"}, "checkin_bundle_keys")
    checkin = require_keys(payload["checkin"], CHECKIN_KEYS, "checkin_keys")
    revision = require_keys(payload["revision"], REVISION_KEYS, "revision_keys")
    general = validate_general_payload(revision["general_payload"])
    checkin_id = require_uuid(checkin["id"])
    require_uuid(checkin["mission_id"])
    root_id = require_uuid(checkin["root_id"])
    require_uuid(revision["id"])
    if checkin["type"] not in CHECKIN_TYPES or checkin["source"] not in MEASUREMENT_SOURCES:
        fail("checkin_fields")
    if not isinstance(checkin["device_id"], str) or DEVICE_RE.fullmatch(checkin["device_id"]) is None:
        fail("checkin_fields")
    if not isinstance(checkin["timezone"], str) or TIMEZONE_RE.fullmatch(checkin["timezone"]) is None:
        fail("checkin_fields")
    require_date(checkin["local_date"], "checkin_fields")
    optional_uuid(checkin["demo_dataset_id"], "demo_dataset_id")
    require_timestamp(checkin["recorded_at"], "recorded_at")
    require_timestamp(checkin["created_at_device"], "created_at_device")
    if not is_int(revision["revision_no"]) or not 1 <= revision["revision_no"] <= 1000:
        fail("revision_no")
    parent = optional_uuid(revision["parent_revision_id"], "parent_revision_id")
    if revision["revision_no"] == 1:
        if parent is not None or revision["reason"] is not None or root_id != checkin_id:
            fail("first_revision")
    else:
        reason = revision["reason"]
        if parent is None or not isinstance(reason, str) or not 1 <= len(reason) <= 300:
            fail("correction_reason")
    measurement_ids = payload["measurement_ids"]
    if not isinstance(measurement_ids, list) or len(measurement_ids) > 50:
        fail("measurement_id")
    parsed_ids = [require_uuid(item, "measurement_id") for item in measurement_ids]
    if len(set(parsed_ids)) != len(parsed_ids):
        fail("measurement_id")
    personal = payload["personal"]
    if personal is not None:
        personal_body = require_keys(personal, {"consent_event_id", "id", "personal_payload"}, "personal_keys")
        require_uuid(personal_body["id"], "personal_id")
        require_uuid(personal_body["consent_event_id"], "personal_id")
        validate_personal_payload(personal_body["personal_payload"])
    revision["general_payload"] = general
    return payload


def validate_invalidation(value: object) -> dict[str, Any]:
    payload = require_keys(value, INVALIDATION_KEYS, "invalidation_keys")
    require_uuid(payload["id"])
    require_uuid(payload["mission_id"])
    require_uuid(payload["target_id"])
    if payload["target_type"] not in INVALIDATION_TARGETS:
        fail("invalidation_fields")
    if not isinstance(payload["device_id"], str) or DEVICE_RE.fullmatch(payload["device_id"]) is None:
        fail("invalidation_fields")
    if not isinstance(payload["reason"], str) or not 1 <= len(payload["reason"]) <= 300:
        fail("invalidation_fields")
    require_timestamp(payload["recorded_at"], "recorded_at")
    require_timestamp(payload["created_at_device"], "created_at_device")
    return payload


def validate_preferences(value: object) -> dict[str, Any]:
    payload = require_keys(value, PREFERENCE_KEYS, "profile_keys")
    if payload["locale"] not in LOCALES:
        fail("profile_fields")
    if not isinstance(payload["timezone"], str) or TIMEZONE_RE.fullmatch(payload["timezone"]) is None:
        fail("profile_fields")
    if payload["default_sharing"] not in SHARING_MODES or not isinstance(payload["reproductive_enabled"], bool):
        fail("profile_fields")
    age = payload["age"]
    if age is not None and (not is_int(age) or not 18 <= age <= 100):
        fail("age")
    if payload["sex_context"] is not None and payload["sex_context"] not in SEX_CONTEXTS:
        fail("sex_context")
    if payload["cycle_context"] is not None and payload["cycle_context"] not in CYCLE_CONTEXTS:
        fail("cycle_context")
    return payload


def validate_consent(value: object) -> dict[str, Any]:
    payload = require_keys(value, CONSENT_KEYS, "consent_keys")
    require_uuid(payload["id"])
    require_uuid(payload["mission_id"])
    if payload["scope"] not in CONSENT_SCOPES or payload["decision"] not in CONSENT_DECISIONS:
        fail("consent_fields")
    require_timestamp(payload["recorded_at"], "recorded_at")
    require_timestamp(payload["created_at_device"], "created_at_device")
    assignment = optional_uuid(payload["assignment_id"], "assignment_id")
    if payload["scope"] == "personal_sharing" and assignment is None:
        fail("assignment_required")
    optional_uuid(payload["supersedes_id"], "supersedes_id")
    return payload


def validate_report_shape(value: object) -> dict[str, Any]:
    payload = require_keys(value, {"personal", "report"}, "report_bundle_keys")
    report = require_keys(payload["report"], REPORT_KEYS, "report_keys")
    snapshot = require_keys(report["general_snapshot"], SNAPSHOT_KEYS, "snapshot_keys")
    if contains_key(snapshot, SNAPSHOT_FORBIDDEN):
        fail("snapshot_personal_field")
    require_uuid(report["id"])
    require_uuid(report["mission_id"])
    recipient = require_uuid(report["recipient_assignment_id"])
    if snapshot["schema_version"] != 1 or isinstance(snapshot["schema_version"], bool):
        fail("snapshot_mismatch")
    if require_uuid(snapshot["recipient_assignment_id"]) != recipient:
        fail("snapshot_mismatch")
    if snapshot["message"] != report["message"]:
        fail("snapshot_mismatch")
    title = report["title"]
    summary = snapshot["summary"]
    if not isinstance(title, str) or not 1 <= len(title) <= 120 or report["reason"] not in REPORT_REASONS:
        fail("report_fields")
    if not isinstance(report["device_id"], str) or DEVICE_RE.fullmatch(report["device_id"]) is None:
        fail("report_fields")
    start = require_date(report["range_start"], "report_fields")
    end = require_date(report["range_end"], "report_fields")
    if start > end or not isinstance(summary, str) or not 1 <= len(summary) <= 2000:
        fail("report_fields")
    message = report["message"]
    if message is not None and (not isinstance(message, str) or not 1 <= len(message) <= 2000):
        fail("message")
    optional_uuid(report["parent_report_id"], "parent_report")
    require_timestamp(report["recorded_at"], "recorded_at")
    require_timestamp(report["created_at_device"], "created_at_device")
    require_timestamp(snapshot["prepared_at"], "prepared_at")
    revision_ids = snapshot["revision_ids"]
    if not isinstance(revision_ids, list) or len(revision_ids) > 100:
        fail("revision_id")
    parsed_revisions = [require_uuid(item, "revision_id") for item in revision_ids]
    if len(set(parsed_revisions)) != len(parsed_revisions):
        fail("revision_id")
    measurements = snapshot["measurements"]
    if not isinstance(measurements, list) or len(measurements) > 100:
        fail("snapshot_measurements")
    if len(parsed_revisions) == 0 and len(measurements) == 0:
        fail("empty_report")
    for item in measurements:
        measurement = require_keys(item, SNAPSHOT_MEASUREMENT_KEYS, "snapshot_measurement")
        require_uuid(measurement["measurement_id"], "snapshot_measurement")
        if measurement["metric"] not in METRICS or measurement["source"] not in MEASUREMENT_SOURCES:
            fail("snapshot_measurement")
        if measurement["quality"] not in MEASUREMENT_QUALITIES:
            fail("snapshot_measurement")
        require_timestamp(measurement["recorded_at"], "snapshot_measurement")
        measurement_number(measurement["metric"], measurement["value"])
    rules = snapshot["explanatory_rule_versions"]
    if not isinstance(rules, list) or len(rules) > 20:
        fail("rule_versions")
    for item in rules:
        if not isinstance(item, dict) or set(item) != {"rule_id", "version"}:
            fail("rule_versions")
        if not isinstance(item["rule_id"], str) or not 1 <= len(item["rule_id"]) <= 80:
            fail("rule_versions")
        if not isinstance(item["version"], str) or not 1 <= len(item["version"]) <= 40:
            fail("rule_versions")
    personal = payload["personal"]
    if personal is not None:
        personal_body = require_keys(personal, {"consent_event_id", "personal_snapshot"}, "personal_keys")
        require_uuid(personal_body["consent_event_id"], "personal_consent")
        validate_personal_payload(personal_body["personal_snapshot"])
    return payload
