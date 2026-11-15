import { zonedInputToDate } from './clock.ts'
import type {
  Appetite,
  Awakenings,
  ContextCode,
  EmotionalState,
  FluidCompleteness,
  Impact,
  MealPlan,
  NutritionDeviation,
  OnsetCategory,
  OverallState,
  Persistence,
  SectionFill,
  SleepDurationSource,
  SleepInterfering,
  SleepIntervalKind,
  SleepIntervalQuality,
  SleepPlanDeviation,
  Sleepiness,
  SymptomCode,
} from './enums.ts'
import {
  hasUsableIntervals,
  hasUsableOverall,
  type SleepInterval,
} from './sleepIntervals.ts'
import {
  FLUID_ML_MAX,
  generalPayloadSchema,
  skippedNutrition,
  type GeneralPayload,
  type NutritionPayload,
} from './generalPayload.ts'
import { buildPersonalPayload, emptyPersonalFields, type PersonalDraftFields } from './personalDraft.ts'
import type { SharingMode } from './enums.ts'

export const FUTURE_LIMIT_MS = 5 * 60 * 1000

export type CheckinStep = 'general' | 'sleep' | 'nutrition' | 'symptoms' | 'personal' | 'measurements' | 'review'

export function checkinSteps(personalEnabled: boolean, type: 'daily' | 'change' = 'daily'): CheckinStep[] {
  if (type === 'change') {
    if (personalEnabled) return ['general', 'symptoms', 'personal', 'measurements', 'review']
    return ['general', 'symptoms', 'measurements', 'review']
  }
  if (personalEnabled) return ['general', 'sleep', 'nutrition', 'symptoms', 'personal', 'measurements', 'review']
  return ['general', 'sleep', 'nutrition', 'symptoms', 'measurements', 'review']
}

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

export type SleepIntervalDraft = {
  startLocal: string
  endLocal: string
  kind: SleepIntervalKind
  quality: SleepIntervalQuality
}

export type CheckinDraftValues = {
  recordedAtLocal: string
  type: 'daily' | 'change'
  overallState: OverallState | null
  sleepHours: string
  sleepSkip: boolean
  sleepQuality: number | null
  sleepQualitySkip: boolean
  sleepiness: Sleepiness | null
  sleepinessSkip: boolean
  awakenings: Awakenings | null
  awakeningsSkip: boolean
  sleepPlanDeviation: SleepPlanDeviation | null
  sleepPlanDeviationSkip: boolean
  sleepInterfering: SleepInterfering[]
  sleepInterferingSkip: boolean
  sleepInterferingOther: string
  sleepDiscuss: boolean | null
  sleepDiscussSkip: boolean
  sleepComment: string
  sleepIntervals: SleepIntervalDraft[]
  sleepDurationSource: SleepDurationSource | null
  fatigue: number | null
  fatigueSkip: boolean
  stress: number | null
  stressSkip: boolean
  emotional: EmotionalState | null
  emotionalNote: string
  context: ContextCode[]
  contextNote: string
  comment: string
  nutritionFill: SectionFill | null
  appetite: Appetite | null
  appetiteSkip: boolean
  mealPlan: MealPlan | null
  mealPlanSkip: boolean
  missedMeals: string
  missedMealsUnknown: boolean
  deviationReason: NutritionDeviation | null
  deviationReasonSkip: boolean
  fluidRaw: string
  fluidSkip: boolean
  fluidCompleteness: FluidCompleteness | null
  nutritionComment: string
  nutritionPeriodStartLocal: string
  nutritionPeriodEndLocal: string
  symptomPresence: 'no' | 'yes' | 'declined' | null
  symptoms: SymptomDraft[]
  reviewRequested: boolean | null
  measurementIds: string[]
} & PersonalDraftFields

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

export function emptyCheckinDraft(
  type: 'daily' | 'change',
  recordedAtLocal: string,
  sharing: SharingMode = 'device_only',
): CheckinDraftValues {
  return {
    recordedAtLocal,
    type,
    overallState: null,
    sleepHours: '',
    sleepSkip: false,
    sleepQuality: null,
    sleepQualitySkip: false,
    sleepiness: null,
    sleepinessSkip: true,
    awakenings: null,
    awakeningsSkip: true,
    sleepPlanDeviation: null,
    sleepPlanDeviationSkip: true,
    sleepInterfering: [],
    sleepInterferingSkip: true,
    sleepInterferingOther: '',
    sleepDiscuss: null,
    sleepDiscussSkip: true,
    sleepComment: '',
    sleepIntervals: [],
    sleepDurationSource: null,
    fatigue: null,
    fatigueSkip: false,
    stress: null,
    stressSkip: false,
    emotional: null,
    emotionalNote: '',
    context: [],
    contextNote: '',
    comment: '',
    nutritionFill: type === 'change' ? 'not_applicable' : null,
    appetite: null,
    appetiteSkip: false,
    mealPlan: null,
    mealPlanSkip: false,
    missedMeals: '',
    missedMealsUnknown: false,
    deviationReason: null,
    deviationReasonSkip: false,
    fluidRaw: '',
    fluidSkip: false,
    fluidCompleteness: null,
    nutritionComment: '',
    nutritionPeriodStartLocal: '',
    nutritionPeriodEndLocal: '',
    symptomPresence: null,
    symptoms: [],
    reviewRequested: null,
    measurementIds: [],
    ...emptyPersonalFields(sharing),
  }
}

export function issuesForStep(
  step: CheckinStep,
  values: CheckinDraftValues,
  timeZone: string,
  now: Date,
  personalEnabled = false,
): DraftIssue[] {
  if (step === 'general') return generalOnlyIssues(values, timeZone, now)
  if (step === 'sleep') return sleepIssues(values, timeZone)
  if (step === 'nutrition') return nutritionIssues(values, timeZone, now)
  if (step === 'symptoms') return symptomIssues(values)
  if (step === 'personal') return buildPersonalPayload(values, personalEnabled).issues
  if (step === 'review') {
    const issues = buildGeneralPayload(values, timeZone, now).issues
    if (personalEnabled) issues.push(...buildPersonalPayload(values, true).issues)
    return issues
  }
  return []
}

export function buildGeneralPayload(
  values: CheckinDraftValues,
  timeZone: string,
  now: Date,
): { payload: GeneralPayload | null; issues: DraftIssue[] } {
  const issues = [
    ...generalOnlyIssues(values, timeZone, now),
    ...(values.type === 'change' ? [] : sleepIssues(values, timeZone)),
    ...(values.type === 'change' ? [] : nutritionIssues(values, timeZone, now)),
    ...symptomIssues(values),
  ]
  if (issues.length > 0) return { payload: null, issues }
  const parsed = generalPayloadSchema.safeParse(toPayload(values, timeZone, now))
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
  const nutrition = payload.nutrition
  return {
    recordedAtLocal,
    type,
    overallState: payload.overall_state,
    sleepHours: payload.sleep_hours === null ? '' : String(payload.sleep_hours),
    sleepSkip: payload.sleep_answer_status !== 'answered',
    sleepQuality: payload.sleep_quality,
    sleepQualitySkip: payload.sleep_quality_answer_status !== 'answered',
    sleepiness: payload.sleepiness,
    sleepinessSkip: payload.sleepiness_answer_status !== 'answered',
    awakenings: payload.awakenings,
    awakeningsSkip: payload.awakenings_answer_status !== 'answered',
    sleepPlanDeviation: payload.sleep_plan_deviation,
    sleepPlanDeviationSkip: payload.sleep_plan_deviation_answer_status !== 'answered',
    sleepInterfering: payload.sleep_interfering.map((item) => item.code),
    sleepInterferingSkip: payload.sleep_interfering_answer_status !== 'answered',
    sleepInterferingOther: payload.sleep_interfering.find((item) => item.code === 'other')?.custom_label ?? '',
    sleepDiscuss: payload.sleep_discuss,
    sleepDiscussSkip: payload.sleep_discuss_answer_status !== 'answered',
    sleepComment: payload.sleep_comment ?? '',
    sleepIntervals: payload.sleep_intervals.map((item) => ({
      startLocal: toLocalInput(item.start_at),
      endLocal: toLocalInput(item.end_at),
      kind: item.kind,
      quality: item.quality,
    })),
    sleepDurationSource: payload.sleep_duration_source,
    fatigue: payload.fatigue_score,
    fatigueSkip: payload.fatigue_answer_status !== 'answered',
    stress: payload.stress_score,
    stressSkip: payload.stress_answer_status !== 'answered',
    emotional: payload.emotional_state.value,
    emotionalNote: payload.emotional_state.note ?? '',
    context: payload.context.map((item) => item.code),
    contextNote: payload.context.find((item) => item.code === 'other')?.custom_label ?? '',
    comment: payload.comment ?? '',
    nutritionFill: nutrition.section_status,
    appetite: nutrition.appetite,
    appetiteSkip: nutrition.appetite_answer_status !== 'answered',
    mealPlan: nutrition.meal_plan,
    mealPlanSkip: nutrition.meal_plan_answer_status !== 'answered',
    missedMeals: nutrition.missed_meals === null ? '' : String(nutrition.missed_meals),
    missedMealsUnknown: nutrition.missed_meals_answer_status === 'unknown',
    deviationReason: nutrition.deviation_reason,
    deviationReasonSkip: nutrition.deviation_reason_answer_status !== 'answered',
    fluidRaw: nutrition.fluid_ml === null ? '' : String(nutrition.fluid_ml),
    fluidSkip: nutrition.fluid_answer_status !== 'answered',
    fluidCompleteness: nutrition.fluid_completeness,
    nutritionComment: nutrition.comment ?? '',
    nutritionPeriodStartLocal: '',
    nutritionPeriodEndLocal: '',
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
    ...emptyPersonalFields(),
  }
}

export function isFilledLater(recordedAt: Date, createdAt: Date): boolean {
  return recordedAt.getTime() + FUTURE_LIMIT_MS < createdAt.getTime()
}

export function defaultReportPeriod(recordedAt: Date): { start_at: string; end_at: string } {
  const end = recordedAt
  const start = new Date(recordedAt.getTime() - 24 * 60 * 60 * 1000)
  return { start_at: start.toISOString(), end_at: end.toISOString() }
}

export { skippedNutrition }

function generalOnlyIssues(values: CheckinDraftValues, timeZone: string, now: Date): DraftIssue[] {
  const issues: DraftIssue[] = []
  const recorded = zonedInputToDate(values.recordedAtLocal, timeZone)
  if (recorded === null) {
    issues.push({ path: 'recordedAtLocal', message: 'required' })
  } else if (recorded.getTime() > now.getTime() + FUTURE_LIMIT_MS) {
    issues.push({ path: 'recordedAtLocal', message: 'future_limit' })
  }
  if (values.overallState === null) issues.push({ path: 'overallState', message: 'required' })
  issues.push(...scoreOrSkip(values.fatigue, values.fatigueSkip, 'fatigue'))
  issues.push(...scoreOrSkip(values.stress, values.stressSkip, 'stress'))
  if (values.emotional === null) issues.push({ path: 'emotional', message: 'required' })
  if (values.emotionalNote.trim().length > 120) issues.push({ path: 'emotionalNote', message: 'too_long' })
  if (values.contextNote.trim().length > 120) issues.push({ path: 'contextNote', message: 'too_long' })
  if (values.comment.trim().length > 1000) issues.push({ path: 'comment', message: 'too_long' })
  return issues
}

function sleepIssues(values: CheckinDraftValues, timeZone?: string): DraftIssue[] {
  const issues: DraftIssue[] = []
  const hasIntervals = values.sleepIntervals.length > 0
  if (!values.sleepSkip || !hasIntervals) {
    issues.push(...numberOrSkip(values.sleepHours, values.sleepSkip, 0, 24, 0.5, 'sleepHours'))
  } else if (values.sleepHours.trim() !== '') {
    issues.push(...numberOrSkip(values.sleepHours, false, 0, 24, 0.5, 'sleepHours'))
  }
  if (!values.sleepQualitySkip && (values.sleepQuality === null || values.sleepQuality < 1 || values.sleepQuality > 5)) {
    issues.push({ path: 'sleepQuality', message: 'required' })
  }
  if (!values.sleepinessSkip && values.sleepiness === null) issues.push({ path: 'sleepiness', message: 'required' })
  if (!values.awakeningsSkip && values.awakenings === null) issues.push({ path: 'awakenings', message: 'required' })
  if (!values.sleepPlanDeviationSkip && values.sleepPlanDeviation === null) {
    issues.push({ path: 'sleepPlanDeviation', message: 'required' })
  }
  if (!values.sleepInterferingSkip) {
    if (values.sleepInterfering.length === 0) issues.push({ path: 'sleepInterfering', message: 'required' })
    if (values.sleepInterfering.includes('other') && values.sleepInterferingOther.trim().length === 0) {
      issues.push({ path: 'sleepInterferingOther', message: 'required' })
    }
  }
  if (!values.sleepDiscussSkip && values.sleepDiscuss === null) issues.push({ path: 'sleepDiscuss', message: 'required' })
  if (values.sleepComment.trim().length > 500) issues.push({ path: 'sleepComment', message: 'too_long' })

  for (let i = 0; i < values.sleepIntervals.length; i += 1) {
    const item = values.sleepIntervals[i]!
    if (item.startLocal.trim() === '' || item.endLocal.trim() === '') {
      issues.push({ path: `sleepIntervals.${i}`, message: 'required' })
      continue
    }
    if (timeZone) {
      const start = zonedInputToDate(item.startLocal, timeZone)
      const end = zonedInputToDate(item.endLocal, timeZone)
      if (!start || !end || end.getTime() <= start.getTime()) {
        issues.push({ path: `sleepIntervals.${i}.endLocal`, message: 'period_order' })
      }
    }
  }

  const overallOk = !values.sleepSkip && values.sleepHours.trim() !== ''
  if (overallOk && hasIntervals && values.sleepDurationSource === null) {
    issues.push({ path: 'sleepDurationSource', message: 'sleep_source_required' })
  }
  return issues
}

function nutritionIssues(values: CheckinDraftValues, timeZone: string, now: Date): DraftIssue[] {
  const issues: DraftIssue[] = []
  if (values.nutritionFill === null) {
    issues.push({ path: 'nutritionFill', message: 'required' })
    return issues
  }
  if (values.nutritionFill !== 'filled') return issues

  if (!values.appetiteSkip && values.appetite === null) issues.push({ path: 'appetite', message: 'required' })
  if (!values.mealPlanSkip && values.mealPlan === null) issues.push({ path: 'mealPlan', message: 'required' })

  const planPartial = !values.mealPlanSkip && (values.mealPlan === 'partial' || values.mealPlan === 'not_done')
  if (planPartial) {
    if (!values.missedMealsUnknown) {
      issues.push(...numberOrSkip(values.missedMeals, false, 0, 20, 1, 'missedMeals'))
    }
    if (!values.deviationReasonSkip && values.deviationReason === null) {
      issues.push({ path: 'deviationReason', message: 'required' })
    }
  }

  if (!values.fluidSkip) {
    const fluid = Number(values.fluidRaw)
    if (values.fluidRaw.trim() === '' || !Number.isFinite(fluid) || fluid < 0 || fluid > FLUID_ML_MAX) {
      issues.push({ path: 'fluidRaw', message: 'out_of_range' })
    } else if (Math.abs(fluid - Math.round(fluid)) > 1e-9) {
      issues.push({ path: 'fluidRaw', message: 'step' })
    }
    if (values.fluidCompleteness === null) issues.push({ path: 'fluidCompleteness', message: 'required' })
  } else if (values.fluidRaw.trim() !== '') {
    issues.push({ path: 'fluidRaw', message: 'skip_and_value' })
  }

  if (values.nutritionComment.trim().length > 500) issues.push({ path: 'nutritionComment', message: 'too_long' })

  const recorded = zonedInputToDate(values.recordedAtLocal, timeZone) ?? now
  const defaultPeriod = defaultReportPeriod(recorded)
  const start =
    values.nutritionPeriodStartLocal.trim() === ''
      ? new Date(defaultPeriod.start_at)
      : zonedInputToDate(values.nutritionPeriodStartLocal, timeZone)
  const end =
    values.nutritionPeriodEndLocal.trim() === ''
      ? new Date(defaultPeriod.end_at)
      : zonedInputToDate(values.nutritionPeriodEndLocal, timeZone)
  if (start === null || end === null) {
    issues.push({ path: 'nutritionPeriodStartLocal', message: 'required' })
  } else if (start.getTime() >= end.getTime()) {
    issues.push({ path: 'nutritionPeriodEndLocal', message: 'period_order' })
  } else if (end.getTime() > recorded.getTime() + FUTURE_LIMIT_MS) {
    issues.push({ path: 'nutritionPeriodEndLocal', message: 'future_limit' })
  }
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

function toPayload(values: CheckinDraftValues, timeZone: string, now: Date): GeneralPayload {
  const recorded = zonedInputToDate(values.recordedAtLocal, timeZone) ?? now
  const reportPeriod = defaultReportPeriod(recorded)
  const change = values.type === 'change'
  const sleepSkip = change || values.sleepSkip
  const presence = values.symptomPresence ?? 'no'

  return {
    overall_state: values.overallState ?? 'fair',
    report_period: reportPeriod,
    sleep_hours: sleepSkip ? null : Number(values.sleepHours),
    sleep_answer_status: change ? 'not_applicable' : sleepSkip ? 'unknown' : 'answered',
    sleep_quality: change || values.sleepQualitySkip ? null : values.sleepQuality,
    sleep_quality_answer_status: change ? 'not_applicable' : values.sleepQualitySkip ? 'declined' : 'answered',
    sleepiness: change || values.sleepinessSkip ? null : values.sleepiness,
    sleepiness_answer_status: change ? 'not_applicable' : values.sleepinessSkip ? 'declined' : 'answered',
    awakenings: change || values.awakeningsSkip ? null : values.awakenings,
    awakenings_answer_status: change ? 'not_applicable' : values.awakeningsSkip ? 'declined' : 'answered',
    sleep_plan_deviation: change || values.sleepPlanDeviationSkip ? null : values.sleepPlanDeviation,
    sleep_plan_deviation_answer_status: change
      ? 'not_applicable'
      : values.sleepPlanDeviationSkip
        ? 'declined'
        : 'answered',
    sleep_interfering:
      change || values.sleepInterferingSkip
        ? []
        : values.sleepInterfering.map((code) => ({
            code,
            custom_label:
              code === 'other' && values.sleepInterferingOther.trim() !== ''
                ? values.sleepInterferingOther.trim()
                : null,
          })),
    sleep_interfering_answer_status: change
      ? 'not_applicable'
      : values.sleepInterferingSkip
        ? 'declined'
        : 'answered',
    sleep_discuss: change || values.sleepDiscussSkip ? null : values.sleepDiscuss,
    sleep_discuss_answer_status: change ? 'not_applicable' : values.sleepDiscussSkip ? 'declined' : 'answered',
    sleep_comment: change || values.sleepComment.trim() === '' ? null : values.sleepComment.trim(),
    sleep_intervals: change ? [] : draftSleepIntervals(values, timeZone),
    sleep_duration_source: change ? null : resolveDraftSleepSource(values, timeZone),
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
    nutrition: buildNutritionPayload(values, timeZone, recorded, reportPeriod, change),
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

function buildNutritionPayload(
  values: CheckinDraftValues,
  timeZone: string,
  recorded: Date,
  reportPeriod: { start_at: string; end_at: string },
  change: boolean,
): NutritionPayload {
  const status: SectionFill = change
    ? 'not_applicable'
    : values.nutritionFill === 'filled'
      ? 'filled'
      : values.nutritionFill === 'skipped'
        ? 'skipped'
        : 'skipped'
  if (status !== 'filled') {
    return skippedNutrition(status === 'not_applicable' ? 'not_applicable' : 'skipped')
  }

  const planPartial = !values.mealPlanSkip && (values.mealPlan === 'partial' || values.mealPlan === 'not_done')
  const start =
    values.nutritionPeriodStartLocal.trim() === ''
      ? reportPeriod.start_at
      : (zonedInputToDate(values.nutritionPeriodStartLocal, timeZone) ?? recorded).toISOString()
  const end =
    values.nutritionPeriodEndLocal.trim() === ''
      ? reportPeriod.end_at
      : (zonedInputToDate(values.nutritionPeriodEndLocal, timeZone) ?? recorded).toISOString()

  return {
    section_status: 'filled',
    appetite: values.appetiteSkip ? null : values.appetite,
    appetite_answer_status: values.appetiteSkip ? 'declined' : 'answered',
    meal_plan: values.mealPlanSkip ? null : values.mealPlan,
    meal_plan_answer_status: values.mealPlanSkip ? 'declined' : 'answered',
    missed_meals: planPartial ? (values.missedMealsUnknown ? null : Number(values.missedMeals)) : null,
    missed_meals_answer_status: planPartial
      ? values.missedMealsUnknown
        ? 'unknown'
        : 'answered'
      : 'not_applicable',
    deviation_reason: planPartial ? (values.deviationReasonSkip ? null : values.deviationReason) : null,
    deviation_reason_answer_status: planPartial
      ? values.deviationReasonSkip
        ? 'declined'
        : 'answered'
      : 'not_applicable',
    fluid_ml: values.fluidSkip ? null : Number(values.fluidRaw),
    fluid_answer_status: values.fluidSkip ? 'unknown' : 'answered',
    fluid_completeness: values.fluidSkip ? null : values.fluidCompleteness,
    comment: values.nutritionComment.trim() === '' ? null : values.nutritionComment.trim(),
    period_start: start,
    period_end: end,
  }
}

function draftSleepIntervals(values: CheckinDraftValues, timeZone: string): SleepInterval[] {
  return values.sleepIntervals.flatMap((item) => {
    const start = zonedInputToDate(item.startLocal, timeZone)
    const end = zonedInputToDate(item.endLocal, timeZone)
    if (!start || !end) return []
    return [
      {
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        kind: item.kind,
        quality: item.quality,
      },
    ]
  })
}

function resolveDraftSleepSource(values: CheckinDraftValues, timeZone: string): SleepDurationSource | null {
  if (values.sleepDurationSource) return values.sleepDurationSource
  const intervals = draftSleepIntervals(values, timeZone)
  const overallOk = hasUsableOverall(
    values.sleepSkip ? null : Number(values.sleepHours),
    values.sleepSkip ? 'unknown' : 'answered',
  )
  const intervalsOk = hasUsableIntervals(intervals)
  if (overallOk && intervalsOk) return null
  if (intervalsOk) return 'intervals'
  if (overallOk) return 'overall'
  return null
}

/** Best-effort local datetime-local value from an ISO timestamp (UTC wall clock). */
function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}
