SCHEMA_VERSION = 1

OPERATION_TYPES = (
    "checkin_bundle",
    "measurement",
    "report_bundle",
    "invalidation",
    "profile_preferences",
    "consent_change",
    "care_order_response",
    "report_ack",
)
REPORT_ACK_TYPES = ("device_received", "patient_read")
CARE_ORDER_KINDS = (
    "examination",
    "measurement",
    "recommendation",
    "symptom_monitor",
    "follow_up",
    "workout",
)
CARE_ORDER_DECISIONS = ("done", "skipped", "acknowledged", "unable")

MAX_BODY_BYTES = 256 * 1024

ANSWER_STATUSES = ("answered", "unknown", "declined", "not_applicable")
OVERALL_STATES = ("very_poor", "poor", "fair", "good", "very_good", "cannot_assess")
EMOTIONAL_STATES = ("calm", "tense", "low", "elevated", "other", "declined")
CONTEXT_CODES = ("after_sleep", "after_exertion", "before_sleep", "other")
SYMPTOM_CODES = (
    "headache",
    "dizziness",
    "nausea",
    "abdominal_discomfort",
    "muscle_joint_pain",
    "palpitations",
    "other",
)
ONSET_CATEGORIES = ("now", "earlier_today", "more_than_a_day", "unknown")
PERSISTENCE_VALUES = ("constant", "intermittent", "unknown")
IMPACT_VALUES = ("none", "some", "severe", "cannot_assess")
SYMPTOM_PRESENCE = ("no", "yes", "declined")
BLEEDING_CATEGORIES = ("none", "spotting", "menstrual", "other", "unsure")
BLEEDING_INTENSITIES = ("light", "moderate", "heavy", "cannot_assess")
EXPECTEDNESS_VALUES = ("yes", "no", "unknown")
CYCLE_CONTEXTS = ("natural", "suppression_regimen", "other")
PLAN_ADHERENCE = ("on_plan", "missed_or_changed")
SHARING_MODES = ("device_only", "assigned_doctor")
CHECKIN_TYPES = ("daily", "change")
METRICS = ("heart_rate", "temperature", "spo2", "body_mass")
SLEEPINESS_VALUES = ("none", "mild", "marked")
AWAKENINGS_VALUES = ("none", "occurred", "unknown")
SLEEP_PLAN_DEVIATION = ("no", "yes", "no_plan", "unknown")
SLEEP_INTERFERING = ("noise", "light", "tasks", "discomfort", "other")
SLEEP_INTERVAL_KINDS = ("primary", "additional")
SLEEP_INTERVAL_QUALITIES = ("slept", "in_bed")
SLEEP_DURATION_SOURCES = ("overall", "intervals")
SECTION_FILL = ("filled", "skipped", "not_applicable")
APPETITE_VALUES = ("usual", "decreased", "increased")
MEAL_PLAN_VALUES = ("full", "partial", "not_done", "no_plan", "unknown")
NUTRITION_DEVIATION = ("no_appetite", "nausea", "no_time", "other", "declined")
FLUID_COMPLETENESS = ("full", "partial", "unknown")
FLUID_ML_MAX = 50_000
ACTIVITY_TYPES = ("aerobic", "strength", "other")
ACTIVITY_COMPLETIONS = ("full", "partial", "skipped")
ACTIVITY_SKIP_REASONS = ("no_time", "no_equipment", "wellbeing", "other", "declined")
MEASUREMENT_SOURCES = ("manual", "usb", "simulated")
MEASUREMENT_QUALITIES = ("unknown", "valid", "invalid", "insufficient")
MEASUREMENT_CONTEXTS = ("rest", "after_exertion", "other", "unspecified")
CONSENT_SCOPES = ("general_exchange", "personal_sharing")
CONSENT_DECISIONS = ("granted", "revoked")
REPORT_REASONS = ("planned", "review_request", "reply_to_doctor")
INVALIDATION_TARGETS = ("checkin", "measurement", "report")
SEX_CONTEXTS = ("female", "male", "intersex", "unspecified")
LOCALES = ("ru", "en")
MESSAGE_TYPES = ("acknowledgement", "clarifying_question", "comment")
MEMBERSHIP_ROLES = ("astronaut", "doctor", "commander", "admin")
