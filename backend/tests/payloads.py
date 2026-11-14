from uuid import UUID

RECORDED_AT = "2026-11-01T08:00:00.000Z"
MISSION_ID = UUID("10000000-0000-4000-8000-000000000010")
ASSIGNMENT_MIRA = UUID("10000000-0000-4000-8000-000000000021")


def base_general(**patch):
    payload = {
        "overall_state": "fair",
        "sleep_hours": 7.5,
        "sleep_answer_status": "answered",
        "sleep_quality": None,
        "sleep_quality_answer_status": "unknown",
        "fatigue_score": 0,
        "fatigue_answer_status": "answered",
        "stress_score": None,
        "stress_answer_status": "declined",
        "emotional_state": {"value": "calm", "note": None},
        "context": [],
        "comment": "Самочувствие",
        "symptom_presence": "no",
        "symptoms": [],
        "review_requested": False,
    }
    payload.update(patch)
    return payload


def skipped_personal(**patch):
    payload = {
        "bleeding_category": None,
        "bleeding_category_answer_status": "declined",
        "bleeding_intensity": None,
        "bleeding_intensity_answer_status": "not_applicable",
        "expectedness": None,
        "expectedness_answer_status": "declined",
        "discomfort_score": None,
        "discomfort_answer_status": "unknown",
        "activity_impact": None,
        "activity_impact_answer_status": "declined",
        "cycle_context": None,
        "cycle_context_answer_status": "declined",
        "prescribed_plan_adherence": None,
        "prescribed_plan_adherence_answer_status": "not_applicable",
        "review_requested": False,
        "comment": None,
        "comment_answer_status": "declined",
    }
    payload.update(patch)
    return payload


def checkin_bundle(checkin_id: UUID, revision_id: UUID, **general_patch):
    return {
        "checkin": {
            "id": str(checkin_id),
            "mission_id": str(MISSION_ID),
            "local_date": "2026-11-01",
            "timezone": "UTC",
            "type": "daily",
            "root_id": str(checkin_id),
            "device_id": "device-1",
            "recorded_at": RECORDED_AT,
            "created_at_device": RECORDED_AT,
            "source": "manual",
            "demo_dataset_id": None,
        },
        "revision": {
            "id": str(revision_id),
            "parent_revision_id": None,
            "revision_no": 1,
            "general_payload": base_general(**general_patch),
            "reason": None,
        },
        "personal": None,
        "measurement_ids": [],
    }


def measurement_payload(measurement_id: UUID):
    return {
        "id": str(measurement_id),
        "mission_id": str(MISSION_ID),
        "metric": "heart_rate",
        "value": 72,
        "unit": "bpm",
        "source": "manual",
        "quality": "unknown",
        "quality_reasons": [],
        "context": "rest",
        "note": None,
        "device_metadata": None,
        "algorithm_version": None,
        "attempt_id": None,
        "device_id": "device-1",
        "recorded_at": RECORDED_AT,
        "created_at_device": RECORDED_AT,
        "demo_dataset_id": None,
    }
