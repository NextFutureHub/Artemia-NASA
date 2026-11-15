export const ANSWER_STATUSES = ['answered', 'unknown', 'declined', 'not_applicable'] as const
export type AnswerStatus = (typeof ANSWER_STATUSES)[number]

export const OVERALL_STATES = ['very_poor', 'poor', 'fair', 'good', 'very_good', 'cannot_assess'] as const
export type OverallState = (typeof OVERALL_STATES)[number]

export const EMOTIONAL_STATES = ['calm', 'tense', 'low', 'elevated', 'other', 'declined'] as const
export type EmotionalState = (typeof EMOTIONAL_STATES)[number]

export const CONTEXT_CODES = ['after_sleep', 'after_exertion', 'before_sleep', 'other'] as const
export type ContextCode = (typeof CONTEXT_CODES)[number]

export const SYMPTOM_CODES = [
  'headache',
  'dizziness',
  'nausea',
  'abdominal_discomfort',
  'muscle_joint_pain',
  'palpitations',
  'other',
] as const
export type SymptomCode = (typeof SYMPTOM_CODES)[number]

export const ONSET_CATEGORIES = ['now', 'earlier_today', 'more_than_a_day', 'unknown'] as const
export type OnsetCategory = (typeof ONSET_CATEGORIES)[number]

export const PERSISTENCE_VALUES = ['constant', 'intermittent', 'unknown'] as const
export type Persistence = (typeof PERSISTENCE_VALUES)[number]

export const IMPACT_VALUES = ['none', 'some', 'severe', 'cannot_assess'] as const
export type Impact = (typeof IMPACT_VALUES)[number]

export const SYMPTOM_PRESENCE = ['no', 'yes', 'declined'] as const
export type SymptomPresence = (typeof SYMPTOM_PRESENCE)[number]

export const BLEEDING_CATEGORIES = ['none', 'spotting', 'menstrual', 'other', 'unsure'] as const
export type BleedingCategory = (typeof BLEEDING_CATEGORIES)[number]

export const BLEEDING_INTENSITIES = ['light', 'moderate', 'heavy', 'cannot_assess'] as const
export type BleedingIntensity = (typeof BLEEDING_INTENSITIES)[number]

export const EXPECTEDNESS_VALUES = ['yes', 'no', 'unknown'] as const
export type Expectedness = (typeof EXPECTEDNESS_VALUES)[number]

export const CYCLE_CONTEXTS = ['natural', 'suppression_regimen', 'other'] as const
export type CycleContext = (typeof CYCLE_CONTEXTS)[number]

export const PLAN_ADHERENCE = ['on_plan', 'missed_or_changed'] as const
export type PlanAdherence = (typeof PLAN_ADHERENCE)[number]

export const SHARING_MODES = ['device_only', 'assigned_doctor'] as const
export type SharingMode = (typeof SHARING_MODES)[number]

export const OPERATION_TYPES = [
  'checkin_bundle',
  'measurement',
  'report_bundle',
  'invalidation',
  'profile_preferences',
  'consent_change',
  'care_order_response',
  'report_ack',
] as const
export type OperationType = (typeof OPERATION_TYPES)[number]

export const REPORT_ACK_TYPES = ['device_received', 'patient_read'] as const
export type ReportAckType = (typeof REPORT_ACK_TYPES)[number]

export const CARE_ORDER_KINDS = [
  'examination',
  'measurement',
  'recommendation',
  'symptom_monitor',
  'follow_up',
  'workout',
] as const
export type CareOrderKind = (typeof CARE_ORDER_KINDS)[number]

export const CARE_ORDER_STATUSES = ['active', 'cancelled', 'completed'] as const
export type CareOrderStatus = (typeof CARE_ORDER_STATUSES)[number]

export const CARE_ORDER_DECISIONS = ['done', 'skipped', 'acknowledged', 'unable'] as const
export type CareOrderDecision = (typeof CARE_ORDER_DECISIONS)[number]

export const CHECKIN_TYPES = ['daily', 'change'] as const
export type CheckinType = (typeof CHECKIN_TYPES)[number]

export const METRICS = ['heart_rate', 'temperature', 'spo2', 'body_mass'] as const
export type Metric = (typeof METRICS)[number]

export const SLEEPINESS_VALUES = ['none', 'mild', 'marked'] as const
export type Sleepiness = (typeof SLEEPINESS_VALUES)[number]

export const AWAKENINGS_VALUES = ['none', 'occurred', 'unknown'] as const
export type Awakenings = (typeof AWAKENINGS_VALUES)[number]

export const SLEEP_PLAN_DEVIATION = ['no', 'yes', 'no_plan', 'unknown'] as const
export type SleepPlanDeviation = (typeof SLEEP_PLAN_DEVIATION)[number]

export const SLEEP_INTERFERING = ['noise', 'light', 'tasks', 'discomfort', 'other'] as const
export type SleepInterfering = (typeof SLEEP_INTERFERING)[number]

export const SLEEP_INTERVAL_KINDS = ['primary', 'additional'] as const
export type SleepIntervalKind = (typeof SLEEP_INTERVAL_KINDS)[number]

export const SLEEP_INTERVAL_QUALITIES = ['slept', 'in_bed'] as const
export type SleepIntervalQuality = (typeof SLEEP_INTERVAL_QUALITIES)[number]

/** Which sleep duration source counts for totals — never sum both. */
export const SLEEP_DURATION_SOURCES = ['overall', 'intervals'] as const
export type SleepDurationSource = (typeof SLEEP_DURATION_SOURCES)[number]

export const SECTION_FILL = ['filled', 'skipped', 'not_applicable'] as const
export type SectionFill = (typeof SECTION_FILL)[number]

export const APPETITE_VALUES = ['usual', 'decreased', 'increased'] as const
export type Appetite = (typeof APPETITE_VALUES)[number]

export const MEAL_PLAN_VALUES = ['full', 'partial', 'not_done', 'no_plan', 'unknown'] as const
export type MealPlan = (typeof MEAL_PLAN_VALUES)[number]

export const NUTRITION_DEVIATION = ['no_appetite', 'nausea', 'no_time', 'other', 'declined'] as const
export type NutritionDeviation = (typeof NUTRITION_DEVIATION)[number]

export const FLUID_COMPLETENESS = ['full', 'partial', 'unknown'] as const
export type FluidCompleteness = (typeof FLUID_COMPLETENESS)[number]

export const MEASUREMENT_SOURCES = ['manual', 'usb', 'simulated'] as const
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number]

export const MEASUREMENT_QUALITIES = ['unknown', 'valid', 'invalid', 'insufficient'] as const
export type MeasurementQuality = (typeof MEASUREMENT_QUALITIES)[number]

export const MEASUREMENT_CONTEXTS = ['rest', 'after_exertion', 'other', 'unspecified'] as const
export type MeasurementContext = (typeof MEASUREMENT_CONTEXTS)[number]

export const CONSENT_SCOPES = ['general_exchange', 'personal_sharing'] as const
export type ConsentScope = (typeof CONSENT_SCOPES)[number]

export const CONSENT_DECISIONS = ['granted', 'revoked'] as const
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number]

export const REPORT_REASONS = ['planned', 'review_request', 'reply_to_doctor'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export const INVALIDATION_TARGETS = ['checkin', 'measurement', 'report'] as const
export type InvalidationTarget = (typeof INVALIDATION_TARGETS)[number]

export function isOperationType(value: string): value is OperationType {
  return (OPERATION_TYPES as readonly string[]).includes(value)
}
