import type {
  AnswerStatus,
  BleedingCategory,
  BleedingIntensity,
  CycleContext,
  Expectedness,
  Impact,
  PlanAdherence,
  SharingMode,
} from './enums.ts'
import { personalPayloadSchema, type PersonalPayload } from './personalPayload.ts'

export type PersonalFill = 'yes' | 'skip' | null

export type PersonalDraftFields = {
  personalFill: PersonalFill
  bleeding: BleedingCategory | 'declined' | null
  intensity: BleedingIntensity | null
  intensitySkip: boolean
  expectedness: Expectedness | 'declined' | null
  discomfort: number | null
  discomfortSkip: boolean
  activityImpact: Impact | null
  cycleContext: CycleContext | 'declined' | null
  adherence: PlanAdherence | 'declined' | null
  personalReview: boolean
  personalComment: string
  personalSharing: SharingMode | null
}

export type DraftIssue = { path: string; message: string }

export function emptyPersonalFields(sharing: SharingMode = 'device_only'): PersonalDraftFields {
  return {
    personalFill: null,
    bleeding: null,
    intensity: null,
    intensitySkip: false,
    expectedness: null,
    discomfort: null,
    discomfortSkip: false,
    activityImpact: null,
    cycleContext: null,
    adherence: null,
    personalReview: false,
    personalComment: '',
    personalSharing: sharing,
  }
}

export function buildPersonalPayload(
  values: PersonalDraftFields,
  enabled: boolean,
): { payload: PersonalPayload | null; issues: DraftIssue[]; skipped: boolean } {
  if (!enabled || values.personalFill === 'skip') {
    return { payload: null, issues: [], skipped: true }
  }
  if (values.personalFill !== 'yes') {
    return { payload: null, issues: [{ path: 'personalFill', message: 'required' }], skipped: false }
  }
  const issues: DraftIssue[] = []
  if (values.personalSharing === null) issues.push({ path: 'personalSharing', message: 'sharing_required' })
  if (values.personalComment.trim().length > 1000) issues.push({ path: 'personalComment', message: 'too_long' })
  if (!values.discomfortSkip && values.discomfort !== null && (values.discomfort < 0 || values.discomfort > 10)) {
    issues.push({ path: 'discomfort', message: 'value_out_of_range' })
  }
  const candidate = toPersonal(values)
  const parsed = personalPayloadSchema.safeParse(candidate)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ path: issue.path.join('.') || 'personal', message: issue.message })
    }
  }
  if (issues.length > 0 || !parsed.success) return { payload: null, issues, skipped: false }
  return { payload: parsed.data, issues: [], skipped: false }
}

function toPersonal(values: PersonalDraftFields): PersonalPayload {
  const bleeding = choice(values.bleeding)
  const intensityApplies =
    bleeding.status === 'answered' &&
    (bleeding.value === 'spotting' || bleeding.value === 'menstrual' || bleeding.value === 'other')
  const intensity = intensityApplies ? optionalChoice(values.intensitySkip ? null : values.intensity) : notApplicable()
  const expected = choice(values.expectedness)
  const discomfort = score(values.discomfort, values.discomfortSkip)
  const activity = optionalChoice(values.activityImpact)
  const cycle = choice(values.cycleContext)
  const adherenceApplies = cycle.status === 'answered' && cycle.value === 'suppression_regimen'
  const adherence = adherenceApplies ? choice(values.adherence) : notApplicable()
  const comment = values.personalComment.trim()
  return {
    bleeding_category: bleeding.value,
    bleeding_category_answer_status: bleeding.status,
    bleeding_intensity: intensity.value as BleedingIntensity | null,
    bleeding_intensity_answer_status: intensity.status,
    expectedness: expected.value as Expectedness | null,
    expectedness_answer_status: expected.status,
    discomfort_score: discomfort.value,
    discomfort_answer_status: discomfort.status,
    activity_impact: activity.value as Impact | null,
    activity_impact_answer_status: activity.status,
    cycle_context: cycle.value as CycleContext | null,
    cycle_context_answer_status: cycle.status,
    prescribed_plan_adherence: adherence.value as PlanAdherence | null,
    prescribed_plan_adherence_answer_status: adherence.status,
    review_requested: values.personalReview,
    comment: comment === '' ? null : comment,
    comment_answer_status: comment === '' ? 'unknown' : 'answered',
  }
}

function choice<T extends string>(value: T | 'declined' | null): { value: T | null; status: AnswerStatus } {
  if (value === 'declined') return { value: null, status: 'declined' }
  if (value === null) return { value: null, status: 'unknown' }
  return { value, status: 'answered' }
}

function optionalChoice<T extends string>(value: T | null): { value: T | null; status: AnswerStatus } {
  if (value === null) return { value: null, status: 'unknown' }
  return { value, status: 'answered' }
}

function notApplicable(): { value: null; status: AnswerStatus } {
  return { value: null, status: 'not_applicable' }
}

function score(value: number | null, skip: boolean): { value: number | null; status: AnswerStatus } {
  if (skip || value === null) return { value: null, status: 'unknown' }
  return { value, status: 'answered' }
}
