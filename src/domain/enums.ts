export const ANSWER_STATUSES = ['answered', 'unknown', 'declined', 'not_applicable'] as const
export type AnswerStatus = (typeof ANSWER_STATUSES)[number]

export const OVERALL_STATES = ['very_poor', 'poor', 'fair', 'good', 'very_good'] as const
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
] as const
export type OperationType = (typeof OPERATION_TYPES)[number]

export const CHECKIN_TYPES = ['daily', 'change'] as const
export type CheckinType = (typeof CHECKIN_TYPES)[number]

export const METRICS = ['heart_rate', 'temperature', 'spo2'] as const
export type Metric = (typeof METRICS)[number]

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
