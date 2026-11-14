import { zonedInputToDate } from './clock.ts'
import type {
  ContextCode,
  EmotionalState,
  Impact,
  OnsetCategory,
  OverallState,
  Persistence,
  SymptomCode,
} from './enums.ts'
import { generalPayloadSchema, type GeneralPayload } from './generalPayload.ts'

export const FUTURE_LIMIT_MS = 5 * 60 * 1000

export type CheckinStep = 'general' | 'symptoms' | 'measurements' | 'review'

export type SymptomDraft = {
  code: SymptomCode
  customLabel: string
  severity: number | null
  severitySkip: boolean
  onset: OnsetCategory | null
  persistence: Persistence | null
  impact: Impact | null
  comment: string
}

export type CheckinDraftValues = {
  recordedAtLocal: string
  type: 'daily' | 'change'
  overallState: OverallState | null
  sleepHours: string
  sleepSkip: boolean
  sleepQuality: number | null
  sleepQualitySkip: boolean
  fatigue: number | null
  fatigueSkip: boolean
  stress: number | null
  stressSkip: boolean
  emotional: EmotionalState | null
  emotionalNote: string
  context: ContextCode[]
  contextNote: string
  comment: string
  symptomPresence: 'no' | 'yes' | 'declined' | null
  symptoms: SymptomDraft[]
  reviewRequested: boolean | null
  measurementIds: string[]
}

export type DraftIssue = { path: string; message: string }

export function emptySymptom(code: SymptomCode): SymptomDraft {
  return {
    code,
    customLabel: '',
    severity: null,
    severitySkip: false,
    onset: null,
    persistence: null,
    impact: null,
    comment: '',
  }
}

export function emptyCheckinDraft(type: 'daily' | 'change', recordedAtLocal: string): CheckinDraftValues {
  return {
    recordedAtLocal,
    type,
    overallState: null,
    sleepHours: '',
    sleepSkip: false,
    sleepQuality: null,
    sleepQualitySkip: false,
    fatigue: null,
    fatigueSkip: false,
    stress: null,
    stressSkip: false,
    emotional: null,
    emotionalNote: '',
    context: [],
    contextNote: '',
    comment: '',
    symptomPresence: null,
    symptoms: [],
    reviewRequested: null,
    measurementIds: [],
  }
}

export function issuesForStep(
  step: CheckinStep,
  values: CheckinDraftValues,
  timeZone: string,
  now: Date,
): DraftIssue[] {
  if (step === 'general') return generalIssues(values, timeZone, now)
  if (step === 'symptoms') return symptomIssues(values)
  if (step === 'review') return buildGeneralPayload(values, timeZone, now).issues
  return []
}

export function buildGeneralPayload(
  values: CheckinDraftValues,
  timeZone: string,
  now: Date,
): { payload: GeneralPayload | null; issues: DraftIssue[] } {
  const issues = [...generalIssues(values, timeZone, now), ...symptomIssues(values)]
  if (issues.length > 0) return { payload: null, issues }
  const parsed = generalPayloadSchema.safeParse(toPayload(values))
  if (!parsed.success) {
    return {
      payload: null,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }
  }
  return { payload: parsed.data, issues: [] }
}

export function payloadToDraft(payload: GeneralPayload, recordedAtLocal: string, type: 'daily' | 'change'): CheckinDraftValues {
  return {
    recordedAtLocal,
    type,
    overallState: payload.overall_state,
    sleepHours: payload.sleep_hours === null ? '' : String(payload.sleep_hours),
    sleepSkip: payload.sleep_answer_status !== 'answered',
    sleepQuality: payload.sleep_quality,
    sleepQualitySkip: payload.sleep_quality_answer_status !== 'answered',
    fatigue: payload.fatigue_score,
    fatigueSkip: payload.fatigue_answer_status !== 'answered',
    stress: payload.stress_score,
    stressSkip: payload.stress_answer_status !== 'answered',
    emotional: payload.emotional_state.value,
    emotionalNote: payload.emotional_state.note ?? '',
    context: payload.context.map((item) => item.code),
    contextNote: payload.context.find((item) => item.code === 'other')?.custom_label ?? '',
    comment: payload.comment ?? '',
    symptomPresence: payload.symptom_presence,
    symptoms: payload.symptoms.map((symptom) => ({
      code: symptom.code,
      customLabel: symptom.custom_label ?? '',
      severity: symptom.severity,
      severitySkip: symptom.answer_status !== 'answered',
      onset: symptom.onset_category,
      persistence: symptom.persistence,
      impact: symptom.impact,
      comment: symptom.comment ?? '',
    })),
    reviewRequested: payload.review_requested,
    measurementIds: [],
  }
}

export function isFilledLater(recordedAt: Date, createdAt: Date): boolean {
  return recordedAt.getTime() + FUTURE_LIMIT_MS < createdAt.getTime()
}

function generalIssues(values: CheckinDraftValues, timeZone: string, now: Date): DraftIssue[] {
  const issues: DraftIssue[] = []
  const recorded = zonedInputToDate(values.recordedAtLocal, timeZone)
  if (recorded === null) {
    issues.push({ path: 'recordedAtLocal', message: 'required' })
  } else if (recorded.getTime() > now.getTime() + FUTURE_LIMIT_MS) {
    issues.push({ path: 'recordedAtLocal', message: 'future_limit' })
  }
  if (values.overallState === null) issues.push({ path: 'overallState', message: 'required' })
  issues.push(...numberOrSkip(values.sleepHours, values.sleepSkip, 0, 24, 0.5, 'sleepHours'))
  if (!values.sleepQualitySkip && (values.sleepQuality === null || values.sleepQuality < 1 || values.sleepQuality > 5)) {
    issues.push({ path: 'sleepQuality', message: 'required' })
  }
  issues.push(...scoreOrSkip(values.fatigue, values.fatigueSkip, 'fatigue'))
  issues.push(...scoreOrSkip(values.stress, values.stressSkip, 'stress'))
  if (values.emotional === null) issues.push({ path: 'emotional', message: 'required' })
  if (values.emotionalNote.trim().length > 120) issues.push({ path: 'emotionalNote', message: 'too_long' })
  if (values.contextNote.trim().length > 120) issues.push({ path: 'contextNote', message: 'too_long' })
  if (values.comment.trim().length > 1000) issues.push({ path: 'comment', message: 'too_long' })
  return issues
}

function symptomIssues(values: CheckinDraftValues): DraftIssue[] {
  const issues: DraftIssue[] = []
  if (values.symptomPresence === null) issues.push({ path: 'symptomPresence', message: 'required' })
  if (values.reviewRequested === null) issues.push({ path: 'reviewRequested', message: 'required' })
  if (values.symptomPresence === 'yes') {
    if (values.symptoms.length === 0) issues.push({ path: 'symptoms', message: 'symptoms_required' })
    values.symptoms.forEach((symptom, index) => {
      const prefix = `symptoms.${index}`
      if (symptom.code === 'other' && (symptom.customLabel.trim().length < 2 || symptom.customLabel.trim().length > 80)) {
        issues.push({ path: `${prefix}.customLabel`, message: 'custom_label_required' })
      }
      if (!symptom.severitySkip && (symptom.severity === null || symptom.severity < 0 || symptom.severity > 10)) {
        issues.push({ path: `${prefix}.severity`, message: 'required' })
      }
      if (symptom.onset === null) issues.push({ path: `${prefix}.onset`, message: 'required' })
      if (symptom.persistence === null) issues.push({ path: `${prefix}.persistence`, message: 'required' })
      if (symptom.impact === null) issues.push({ path: `${prefix}.impact`, message: 'required' })
      if (symptom.comment.trim().length > 500) issues.push({ path: `${prefix}.comment`, message: 'too_long' })
    })
  } else if (values.symptoms.length > 0) {
    issues.push({ path: 'symptoms', message: 'symptoms_pending_delete' })
  }
  return issues
}

function numberOrSkip(
  raw: string,
  skip: boolean,
  min: number,
  max: number,
  step: number,
  path: string,
): DraftIssue[] {
  if (skip && raw.trim() !== '') return [{ path, message: 'skip_and_value' }]
  if (skip) return []
  if (raw.trim() === '') return [{ path, message: 'required' }]
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) return [{ path, message: 'out_of_range' }]
  const scaled = value / step
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) return [{ path, message: 'step' }]
  return []
}

function scoreOrSkip(value: number | null, skip: boolean, path: string): DraftIssue[] {
  if (skip) return []
  if (value === null || value < 0 || value > 10) return [{ path, message: 'required' }]
  return []
}

function toPayload(values: CheckinDraftValues): GeneralPayload {
  const sleepSkip = values.sleepSkip
  const presence = values.symptomPresence ?? 'no'
  return {
    overall_state: values.overallState ?? 'fair',
    sleep_hours: sleepSkip ? null : Number(values.sleepHours),
    sleep_answer_status: sleepSkip ? 'unknown' : 'answered',
    sleep_quality: values.sleepQualitySkip ? null : values.sleepQuality,
    sleep_quality_answer_status: values.sleepQualitySkip ? 'declined' : 'answered',
    fatigue_score: values.fatigueSkip ? null : values.fatigue,
    fatigue_answer_status: values.fatigueSkip ? 'declined' : 'answered',
    stress_score: values.stressSkip ? null : values.stress,
    stress_answer_status: values.stressSkip ? 'declined' : 'answered',
    emotional_state: {
      value: values.emotional ?? 'calm',
      note: values.emotional === 'other' && values.emotionalNote.trim() !== '' ? values.emotionalNote.trim() : null,
    },
    context: values.context.map((code) => ({
      code,
      custom_label: code === 'other' && values.contextNote.trim() !== '' ? values.contextNote.trim() : null,
    })),
    comment: values.comment.trim() === '' ? null : values.comment.trim(),
    symptom_presence: presence,
    symptoms:
      presence === 'yes'
        ? values.symptoms.map((symptom) => ({
            code: symptom.code,
            custom_label: symptom.code === 'other' ? symptom.customLabel.trim() : null,
            severity: symptom.severitySkip ? null : symptom.severity,
            answer_status: symptom.severitySkip ? 'declined' : 'answered',
            onset_category: symptom.onset ?? 'unknown',
            persistence: symptom.persistence ?? 'unknown',
            impact: symptom.impact ?? 'cannot_assess',
            comment: symptom.comment.trim() === '' ? null : symptom.comment.trim(),
          }))
        : [],
    review_requested: values.reviewRequested === true,
  }
}
