"""EXT-1 pure helpers for sleep intervals, dual-source sleep, nutrition overlap, activity skip."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID


SleepSource = Literal["overall", "intervals"]


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def interval_duration_hours(start_at: str, end_at: str) -> float | None:
    start = _parse_ts(start_at)
    end = _parse_ts(end_at)
    if end <= start:
        return None
    return (end - start).total_seconds() / 3600.0


def _overlap(a: dict[str, Any], b: dict[str, Any]) -> bool:
    a0, a1 = _parse_ts(a["start_at"]), _parse_ts(a["end_at"])
    b0, b1 = _parse_ts(b["start_at"]), _parse_ts(b["end_at"])
    return a0 < b1 and b0 < a1


def intervals_overlap(intervals: list[dict[str, Any]]) -> bool:
    for i, left in enumerate(intervals):
        for right in intervals[i + 1 :]:
            if _overlap(left, right):
                return True
    return False


def sum_slept_interval_hours(intervals: list[dict[str, Any]]) -> float | None:
    if intervals_overlap(intervals):
        return None
    total = 0.0
    seen: set[tuple[str, str, str, str]] = set()
    for item in intervals:
        key = (item["start_at"], item["end_at"], item.get("kind", ""), item.get("quality", ""))
        if key in seen:
            return None
        seen.add(key)
        if item.get("quality") != "slept":
            continue
        hours = interval_duration_hours(item["start_at"], item["end_at"])
        if hours is None:
            return None
        total += hours
    return total


def resolve_sleep_duration(
    overall_hours: float | None,
    intervals: list[dict[str, Any]],
    source: SleepSource | None = None,
) -> dict[str, Any]:
    has_overall = overall_hours is not None
    has_intervals = len(intervals) > 0
    if not has_overall and not has_intervals:
        return {"ok": False, "issue": "empty"}
    if has_intervals:
        for item in intervals:
            if interval_duration_hours(item["start_at"], item["end_at"]) is None:
                return {"ok": False, "issue": "order"}
        if intervals_overlap(intervals):
            return {"ok": False, "issue": "overlap"}
    if has_overall and has_intervals:
        if source not in ("overall", "intervals"):
            return {"ok": False, "issue": "source_required"}
        if source == "overall":
            return {"ok": True, "hours": overall_hours, "source": "overall"}
        summed = sum_slept_interval_hours(intervals)
        if summed is None:
            return {"ok": False, "issue": "overlap"}
        return {"ok": True, "hours": summed, "source": "intervals"}
    if has_overall:
        return {"ok": True, "hours": overall_hours, "source": "overall"}
    summed = sum_slept_interval_hours(intervals)
    if summed is None:
        return {"ok": False, "issue": "overlap"}
    return {"ok": True, "hours": summed, "source": "intervals"}


def aggregate_daily_fluid_ml(windows: list[dict[str, Any]]) -> dict[str, Any]:
    """Cluster max for overlapping windows — never sum overlapping fluid totals."""
    answered: list[dict[str, Any]] = []
    for window in windows:
        start = _parse_ts(window["period_start"])
        end = _parse_ts(window["period_end"])
        if start >= end:
            return {"ok": False, "issue": "period_order"}
        if window.get("fluid_answer_status") == "answered":
            fluid = window.get("fluid_ml")
            if fluid is None or not isinstance(fluid, (int, float)) or fluid < 0:
                return {"ok": False, "issue": "invalid_fluid"}
            answered.append(window)

    if not answered:
        return {"ok": True, "total_ml": 0, "overlapped": False}

    parent = list(range(len(answered)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        a, b = find(i), find(j)
        if a != b:
            parent[b] = a

    overlapped = False
    for i, left in enumerate(answered):
        for j in range(i + 1, len(answered)):
            right = answered[j]
            a0, a1 = _parse_ts(left["period_start"]), _parse_ts(left["period_end"])
            b0, b1 = _parse_ts(right["period_start"]), _parse_ts(right["period_end"])
            if a0 < b1 and b0 < a1:
                overlapped = True
                union(i, j)

    clusters: dict[int, float] = {}
    for i, row in enumerate(answered):
        root = find(i)
        value = float(row["fluid_ml"])
        clusters[root] = value if root not in clusters else max(clusters[root], value)

    return {"ok": True, "total_ml": sum(clusters.values()), "overlapped": overlapped}


def build_skipped_activity(
    activity_id: UUID,
    mission_id: UUID,
    started_at: str,
    *,
    care_order_id: UUID | None = None,
    skip_reason: str = "no_time",
) -> dict[str, Any]:
    return {
        "id": str(activity_id),
        "mission_id": str(mission_id),
        "started_at": started_at,
        "activity_type": "aerobic",
        "completion": "skipped",
        "planned_duration_min": None if care_order_id is None else 30,
        "actual_duration_min": 0,
        "skip_reason": skip_reason,
        "exertion": None,
        "exertion_answer_status": "not_applicable",
        "care_order_id": None if care_order_id is None else str(care_order_id),
        "measurement_ids": [],
        "comment": None,
    }


def assert_skipped_activity_omits_exertion(payload: dict[str, Any]) -> None:
    assert payload["completion"] == "skipped"
    assert payload["actual_duration_min"] == 0
    assert payload["exertion"] is None
    assert payload["exertion_answer_status"] == "not_applicable"
    assert payload["measurement_ids"] == []
