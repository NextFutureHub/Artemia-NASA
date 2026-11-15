"""EXT-1 pure contract tests (no DB): sleep, nutrition, body mass, profile, care responses."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.care_orders import validate_care_order_response
from app.errors import ContractError
from app.validation import validate_general_payload, validate_measurement, validate_preferences
from tests.payloads import RECORDED_AT, MISSION_ID, base_general, skipped_nutrition


def test_sleep_zero_answered_is_kept():
    payload = validate_general_payload(base_general(sleep_hours=0, sleep_answer_status="answered"))
    assert payload["sleep_hours"] == 0
    assert payload["sleep_answer_status"] == "answered"


def test_sleep_unknown_requires_null_not_zero():
    validate_general_payload(base_general(sleep_hours=None, sleep_answer_status="unknown"))
    with pytest.raises(ContractError):
        validate_general_payload(base_general(sleep_hours=0, sleep_answer_status="unknown"))
    with pytest.raises(ContractError):
        validate_general_payload(base_general(sleep_hours=None, sleep_answer_status="answered"))


def test_nutrition_fluid_not_tracked_distinct_from_zero():
    not_tracked = validate_general_payload(
        base_general(
            nutrition={
                **skipped_nutrition("filled"),
                "section_status": "filled",
                "appetite": None,
                "appetite_answer_status": "declined",
                "meal_plan": "no_plan",
                "meal_plan_answer_status": "answered",
                "fluid_ml": None,
                "fluid_answer_status": "unknown",
                "fluid_completeness": None,
                "period_start": "2026-10-31T08:00:00.000Z",
                "period_end": RECORDED_AT,
            }
        )
    )
    assert not_tracked["nutrition"]["fluid_ml"] is None
    assert not_tracked["nutrition"]["fluid_answer_status"] == "unknown"

    zero = validate_general_payload(
        base_general(
            nutrition={
                **skipped_nutrition("filled"),
                "section_status": "filled",
                "appetite": None,
                "appetite_answer_status": "declined",
                "meal_plan": "no_plan",
                "meal_plan_answer_status": "answered",
                "fluid_ml": 0,
                "fluid_answer_status": "answered",
                "fluid_completeness": "full",
                "period_start": "2026-10-31T08:00:00.000Z",
                "period_end": RECORDED_AT,
            }
        )
    )
    assert zero["nutrition"]["fluid_ml"] == 0
    assert zero["nutrition"]["fluid_answer_status"] == "answered"


def test_body_mass_measurement_base_kg():
    payload = validate_measurement(
        {
            "id": str(uuid4()),
            "mission_id": str(MISSION_ID),
            "metric": "body_mass",
            "value": 70.5,
            "unit": "kg",
            "source": "manual",
            "quality": "unknown",
            "quality_reasons": [],
            "context": "rest",
            "note": None,
            "device_metadata": {"input_value": 155.4, "input_unit": "lb"},
            "algorithm_version": None,
            "attempt_id": None,
            "device_id": "device-1",
            "recorded_at": RECORDED_AT,
            "created_at_device": RECORDED_AT,
            "demo_dataset_id": None,
        }
    )
    assert payload["metric"] == "body_mass"
    assert payload["unit"] == "kg"
    assert payload["value"] == 70.5


def test_profile_preferences_age_sex_unit_system():
    ok = validate_preferences(
        {
            "locale": "en",
            "timezone": "UTC",
            "age": 34,
            "sex_context": "female",
            "reproductive_enabled": True,
            "cycle_context": None,
            "default_sharing": "device_only",
            "unit_system": "us",
        }
    )
    assert ok["unit_system"] == "us"
    assert ok["age"] == 34
    assert ok["sex_context"] == "female"


@pytest.mark.parametrize(
    "patch",
    [
        {"age": 17},
        {"age": 101},
        {"sex_context": "other"},
        {"unit_system": "imperial"},
    ],
)
def test_profile_preferences_rejects_invalid_age_sex_unit(patch):
    body = {
        "locale": "ru",
        "timezone": "UTC",
        "age": 30,
        "sex_context": "male",
        "reproductive_enabled": False,
        "cycle_context": None,
        "default_sharing": "device_only",
        "unit_system": "metric",
    }
    body.update(patch)
    with pytest.raises(ContractError):
        validate_preferences(body)


def _fresh_ts() -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=5)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def test_care_order_response_accepts_unable_with_link_note():
    recorded = _fresh_ts()
    validate_care_order_response(
        {
            "id": str(uuid4()),
            "order_id": str(uuid4()),
            "mission_id": str(MISSION_ID),
            "decision": "unable",
            "note": "Equipment unavailable",
            "link_note": "see measurement attempt",
            "activity_id": None,
            "recorded_at": recorded,
            "created_at_device": recorded,
        }
    )


def test_care_order_response_requires_link_note_key():
    recorded = _fresh_ts()
    with pytest.raises(ContractError):
        validate_care_order_response(
            {
                "id": str(uuid4()),
                "order_id": str(uuid4()),
                "mission_id": str(MISSION_ID),
                "decision": "done",
                "note": None,
                "recorded_at": recorded,
                "created_at_device": recorded,
            }
        )


def test_sleep_interval_crossing_midnight():
    from app.ext1_aggregates import interval_duration_hours, resolve_sleep_duration

    assert interval_duration_hours("2026-11-14T22:30:00.000Z", "2026-11-15T06:30:00.000Z") == 8.0
    resolved = resolve_sleep_duration(
        None,
        [
            {
                "start_at": "2026-11-14T23:00:00.000Z",
                "end_at": "2026-11-15T05:00:00.000Z",
                "kind": "primary",
                "quality": "slept",
            }
        ],
    )
    assert resolved["ok"] is True
    assert resolved["hours"] == 6.0
    assert resolved["source"] == "intervals"


def test_sleep_dual_source_requires_explicit_choice():
    from app.ext1_aggregates import resolve_sleep_duration

    intervals = [
        {
            "start_at": "2026-11-14T22:00:00.000Z",
            "end_at": "2026-11-15T04:00:00.000Z",
            "kind": "primary",
            "quality": "slept",
        }
    ]
    both = resolve_sleep_duration(7.5, intervals)
    assert both["ok"] is False
    assert both["issue"] == "source_required"
    overall = resolve_sleep_duration(7.5, intervals, "overall")
    assert overall == {"ok": True, "hours": 7.5, "source": "overall"}
    from_intervals = resolve_sleep_duration(7.5, intervals, "intervals")
    assert from_intervals["ok"] is True
    assert from_intervals["hours"] == 6.0
    assert from_intervals["hours"] != 7.5 + 6.0


def test_activity_skipped_without_exertion():
    from app.ext1_aggregates import assert_skipped_activity_omits_exertion, build_skipped_activity

    payload = build_skipped_activity(uuid4(), MISSION_ID, RECORDED_AT, care_order_id=uuid4())
    assert_skipped_activity_omits_exertion(payload)
    assert payload["care_order_id"] is not None


def test_activity_standalone_has_no_fictitious_order():
    from app.ext1_aggregates import build_skipped_activity

    payload = build_skipped_activity(uuid4(), MISSION_ID, RECORDED_AT)
    assert payload["care_order_id"] is None
    assert payload["planned_duration_min"] is None


def test_activity_from_task_shares_one_activity_id():
    from app.ext1_aggregates import build_skipped_activity

    activity_id = uuid4()
    order_id = uuid4()
    payload = build_skipped_activity(activity_id, MISSION_ID, RECORDED_AT, care_order_id=order_id)
    assert payload["id"] == str(activity_id)
    assert payload["care_order_id"] == str(order_id)


def test_overlapping_nutrition_windows_do_not_double_fluid():
    from app.ext1_aggregates import aggregate_daily_fluid_ml

    result = aggregate_daily_fluid_ml(
        [
            {
                "period_start": "2026-11-14T12:00:00.000Z",
                "period_end": "2026-11-15T12:00:00.000Z",
                "fluid_ml": 1500,
                "fluid_answer_status": "answered",
            },
            {
                "period_start": "2026-11-15T00:00:00.000Z",
                "period_end": "2026-11-16T00:00:00.000Z",
                "fluid_ml": 800,
                "fluid_answer_status": "answered",
            },
        ]
    )
    assert result["ok"] is True
    assert result["overlapped"] is True
    assert result["total_ml"] == 1500
    assert result["total_ml"] != 2300
