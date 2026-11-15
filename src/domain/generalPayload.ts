import { z } from 'zod'
import {
  ANSWER_STATUSES,
  APPETITE_VALUES,
  AWAKENINGS_VALUES,
  CONTEXT_CODES,
  EMOTIONAL_STATES,
  FLUID_COMPLETENESS,
  IMPACT_VALUES,
  MEAL_PLAN_VALUES,
  NUTRITION_DEVIATION,
  ONSET_CATEGORIES,
  OVERALL_STATES,
  PERSISTENCE_VALUES,
  SECTION_FILL,
  SLEEP_DURATION_SOURCES,
  SLEEP_INTERFERING,
  SLEEP_INTERVAL_KINDS,
  SLEEP_INTERVAL_QUALITIES,
  SLEEP_PLAN_DEVIATION,
  SLEEPINESS_VALUES,
  SYMPTOM_CODES,
  SYMPTOM_PRESENCE,
  type AnswerStatus,
} from './enums.ts'
import {
  hasUsableIntervals,
  hasUsableOverall,
  validateSleepIntervalList,
} from './sleepIntervals.ts'

const answerStatusSchema = z.enum(ANSWER_STATUSES)
const timestampSchema = z.iso.datetime({ offset: true })

/** Technical input ceiling for reported fluid (mL), not a medical norm. */
export const FLUID_ML_MAX = 50_000
/** Technical mass range (kg), prototype guard only. */
export const BODY_MASS_KG_MIN = 20
export const BODY_MASS_KG_MAX = 300

const symptomSchema = z
  .strictObject({
    code: z.enum(SYMPTOM_CODES),
    custom_label: z.string().min(2).max(80).nullable(),
    severity: z.number().int().nullable(),
    answer_status: answerStatusSchema,
    onset_category: z.enum(ONSET_CATEGORIES),
    persistence: z.enum(PERSISTENCE_VALUES),
    impact: z.enum(IMPACT_VALUES),
    comment: z.string().min(1).max(500).nullable(),
  })
  .superRefine((symptom, ctx) => {
    if (symptom.code === 'other') {
      if (symptom.custom_label === null) {
        ctx.addIssue({ code: 'custom', path: ['custom_label'], message: 'custom_label_required' })
      }
    } else if (symptom.custom_label !== null) {
      ctx.addIssue({ code: 'custom', path: ['custom_label'], message: 'custom_label_forbidden' })
    }
    refineAnsweredInteger(symptom.severity, symptom.answer_status, 0, 10, 'severity', ctx)
  })

const contextItemSchema = z
  .strictObject({
    code: z.enum(CONTEXT_CODES),
    custom_label: z.string().min(1).max(120).nullable(),
  })
  .superRefine((item, ctx) => {
    if (item.code !== 'other' && item.custom_label !== null) {
      ctx.addIssue({ code: 'custom', path: ['custom_label'], message: 'custom_label_forbidden' })
    }
  })

const emotionalStateSchema = z
  .strictObject({
    value: z.enum(EMOTIONAL_STATES),
    note: z.string().min(1).max(120).nullable(),
  })
  .superRefine((state, ctx) => {
    if (state.value !== 'other' && state.note !== null) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'note_forbidden' })
    }
  })

const interferingItemSchema = z
  .strictObject({
    code: z.enum(SLEEP_INTERFERING),
    custom_label: z.string().min(1).max(120).nullable(),
  })
  .superRefine((item, ctx) => {
    if (item.code !== 'other' && item.custom_label !== null) {
      ctx.addIssue({ code: 'custom', path: ['custom_label'], message: 'custom_label_forbidden' })
    }
  })

export const sleepIntervalSchema = z.strictObject({
  start_at: timestampSchema,
  end_at: timestampSchema,
  kind: z.enum(SLEEP_INTERVAL_KINDS),
  quality: z.enum(SLEEP_INTERVAL_QUALITIES),
})

const reportPeriodSchema = z
  .strictObject({
    start_at: timestampSchema,
    end_at: timestampSchema,
  })
  .superRefine((period, ctx) => {
    if (Date.parse(period.start_at) >= Date.parse(period.end_at)) {
      ctx.addIssue({ code: 'custom', path: ['end_at'], message: 'period_order' })
    }
  })

export const nutritionPayloadSchema = z
  .strictObject({
    section_status: z.enum(SECTION_FILL),
    appetite: z.enum(APPETITE_VALUES).nullable(),
    appetite_answer_status: answerStatusSchema,
    meal_plan: z.enum(MEAL_PLAN_VALUES).nullable(),
    meal_plan_answer_status: answerStatusSchema,
    missed_meals: z.number().int().nullable(),
    missed_meals_answer_status: answerStatusSchema,
    deviation_reason: z.enum(NUTRITION_DEVIATION).nullable(),
    deviation_reason_answer_status: answerStatusSchema,
    fluid_ml: z.number().nullable(),
    fluid_answer_status: answerStatusSchema,
    fluid_completeness: z.enum(FLUID_COMPLETENESS).nullable(),
    comment: z.string().min(1).max(500).nullable(),
    period_start: timestampSchema.nullable(),
    period_end: timestampSchema.nullable(),
  })
  .superRefine((nutrition, ctx) => {
    if (nutrition.section_status !== 'filled') {
      const nullableFields: Array<keyof typeof nutrition> = [
        'appetite',
        'meal_plan',
        'missed_meals',
        'deviation_reason',
        'fluid_ml',
        'fluid_completeness',
        'comment',
        'period_start',
        'period_end',
      ]
      for (const field of nullableFields) {
        if (nutrition[field] !== null) {
          ctx.addIssue({ code: 'custom', path: [field], message: 'skip_must_be_null' })
        }
      }
      for (const statusField of [
        'appetite_answer_status',
        'meal_plan_answer_status',
        'missed_meals_answer_status',
        'deviation_reason_answer_status',
        'fluid_answer_status',
      ] as const) {
        if (nutrition[statusField] !== 'not_applicable') {
          ctx.addIssue({ code: 'custom', path: [statusField], message: 'section_skip_status' })
        }
      }
      return
    }

    refineOptionalChoice(nutrition.appetite, nutrition.appetite_answer_status, APPETITE_VALUES, 'appetite', ctx)
    refineOptionalChoice(nutrition.meal_plan, nutrition.meal_plan_answer_status, MEAL_PLAN_VALUES, 'meal_plan', ctx)

    const planPartial =
      nutrition.meal_plan_answer_status === 'answered' &&
      (nutrition.meal_plan === 'partial' || nutrition.meal_plan === 'not_done')
    if (planPartial) {
      if (nutrition.missed_meals_answer_status === 'unknown') {
        if (nutrition.missed_meals !== null) {
          ctx.addIssue({ code: 'custom', path: ['missed_meals'], message: 'skip_must_be_null' })
        }
      } else {
        refineAnsweredInteger(nutrition.missed_meals, nutrition.missed_meals_answer_status, 0, 20, 'missed_meals', ctx)
      }
      if (nutrition.deviation_reason_answer_status === 'declined') {
        if (nutrition.deviation_reason !== null) {
          ctx.addIssue({ code: 'custom', path: ['deviation_reason'], message: 'skip_must_be_null' })
        }
      } else {
        refineOptionalChoice(
          nutrition.deviation_reason,
          nutrition.deviation_reason_answer_status,
          NUTRITION_DEVIATION,
          'deviation_reason',
          ctx,
        )
      }
    } else {
      if (nutrition.missed_meals !== null) {
        ctx.addIssue({ code: 'custom', path: ['missed_meals'], message: 'skip_must_be_null' })
      }
      if (nutrition.missed_meals_answer_status !== 'not_applicable') {
        ctx.addIssue({ code: 'custom', path: ['missed_meals_answer_status'], message: 'section_skip_status' })
      }
      if (nutrition.deviation_reason !== null) {
        ctx.addIssue({ code: 'custom', path: ['deviation_reason'], message: 'skip_must_be_null' })
      }
      if (nutrition.deviation_reason_answer_status !== 'not_applicable') {
        ctx.addIssue({ code: 'custom', path: ['deviation_reason_answer_status'], message: 'section_skip_status' })
      }
    }

    if (nutrition.fluid_answer_status === 'answered') {
      if (
        nutrition.fluid_ml === null ||
        !Number.isFinite(nutrition.fluid_ml) ||
        nutrition.fluid_ml < 0 ||
        nutrition.fluid_ml > FLUID_ML_MAX
      ) {
        ctx.addIssue({ code: 'custom', path: ['fluid_ml'], message: 'value_out_of_range' })
      } else {
        const scaled = nutrition.fluid_ml
        if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
          ctx.addIssue({ code: 'custom', path: ['fluid_ml'], message: 'value_step' })
        }
      }
      if (nutrition.fluid_completeness === null) {
        ctx.addIssue({ code: 'custom', path: ['fluid_completeness'], message: 'required' })
      }
    } else {
      if (nutrition.fluid_ml !== null) {
        ctx.addIssue({ code: 'custom', path: ['fluid_ml'], message: 'skip_must_be_null' })
      }
      if (nutrition.fluid_completeness !== null) {
        ctx.addIssue({ code: 'custom', path: ['fluid_completeness'], message: 'skip_must_be_null' })
      }
    }

    if (nutrition.period_start === null || nutrition.period_end === null) {
      ctx.addIssue({ code: 'custom', path: ['period_start'], message: 'required' })
    } else if (Date.parse(nutrition.period_start) >= Date.parse(nutrition.period_end)) {
      ctx.addIssue({ code: 'custom', path: ['period_end'], message: 'period_order' })
    }
  })

export const generalPayloadSchema = z
  .strictObject({
    overall_state: z.enum(OVERALL_STATES),
    report_period: reportPeriodSchema,
    sleep_hours: z.number().nullable(),
    sleep_answer_status: answerStatusSchema,
    sleep_quality: z.number().int().nullable(),
    sleep_quality_answer_status: answerStatusSchema,
    sleepiness: z.enum(SLEEPINESS_VALUES).nullable(),
    sleepiness_answer_status: answerStatusSchema,
    awakenings: z.enum(AWAKENINGS_VALUES).nullable(),
    awakenings_answer_status: answerStatusSchema,
    sleep_plan_deviation: z.enum(SLEEP_PLAN_DEVIATION).nullable(),
    sleep_plan_deviation_answer_status: answerStatusSchema,
    sleep_interfering: z.array(interferingItemSchema).max(5),
    sleep_interfering_answer_status: answerStatusSchema,
    sleep_discuss: z.boolean().nullable(),
    sleep_discuss_answer_status: answerStatusSchema,
    sleep_comment: z.string().min(1).max(500).nullable(),
    sleep_intervals: z.array(sleepIntervalSchema).max(12),
    sleep_duration_source: z.enum(SLEEP_DURATION_SOURCES).nullable(),
    fatigue_score: z.number().int().nullable(),
    fatigue_answer_status: answerStatusSchema,
    stress_score: z.number().int().nullable(),
    stress_answer_status: answerStatusSchema,
    emotional_state: emotionalStateSchema,
    context: z.array(contextItemSchema).max(4),
    comment: z.string().min(1).max(1000).nullable(),
    nutrition: nutritionPayloadSchema,
    symptom_presence: z.enum(SYMPTOM_PRESENCE),
    symptoms: z.array(symptomSchema).max(12),
    review_requested: z.boolean(),
  })
  .superRefine((payload, ctx) => {
    refineAnsweredStep(payload.sleep_hours, payload.sleep_answer_status, 0, 24, 2, 'sleep_hours', ctx)
    refineAnsweredInteger(payload.sleep_quality, payload.sleep_quality_answer_status, 1, 5, 'sleep_quality', ctx)
    refineOptionalChoice(payload.sleepiness, payload.sleepiness_answer_status, SLEEPINESS_VALUES, 'sleepiness', ctx)
    refineOptionalChoice(payload.awakenings, payload.awakenings_answer_status, AWAKENINGS_VALUES, 'awakenings', ctx)
    refineOptionalChoice(
      payload.sleep_plan_deviation,
      payload.sleep_plan_deviation_answer_status,
      SLEEP_PLAN_DEVIATION,
      'sleep_plan_deviation',
      ctx,
    )
    if (payload.sleep_interfering_answer_status === 'answered') {
      if (payload.sleep_interfering.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['sleep_interfering'], message: 'required' })
      }
      const codes = payload.sleep_interfering.map((item) => item.code)
      if (new Set(codes).size !== codes.length) {
        ctx.addIssue({ code: 'custom', path: ['sleep_interfering'], message: 'duplicate_context' })
      }
    } else if (payload.sleep_interfering.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['sleep_interfering'], message: 'must_be_empty' })
    }
    if (payload.sleep_discuss_answer_status === 'answered') {
      if (payload.sleep_discuss === null) {
        ctx.addIssue({ code: 'custom', path: ['sleep_discuss'], message: 'required' })
      }
    } else if (payload.sleep_discuss !== null) {
      ctx.addIssue({ code: 'custom', path: ['sleep_discuss'], message: 'skip_must_be_null' })
    }
    if (payload.sleep_comment !== null && payload.sleep_comment.length > 500) {
      ctx.addIssue({ code: 'custom', path: ['sleep_comment'], message: 'too_long' })
    }

    for (const issue of validateSleepIntervalList(payload.sleep_intervals)) {
      ctx.addIssue({ code: 'custom', path: issue.path.split('.'), message: issue.message })
    }
    const overallOk = hasUsableOverall(payload.sleep_hours, payload.sleep_answer_status)
    const intervalsOk = hasUsableIntervals(payload.sleep_intervals)
    if (overallOk && intervalsOk && payload.sleep_duration_source === null) {
      ctx.addIssue({ code: 'custom', path: ['sleep_duration_source'], message: 'sleep_source_required' })
    }
    if (!overallOk && !intervalsOk && payload.sleep_duration_source !== null) {
      ctx.addIssue({ code: 'custom', path: ['sleep_duration_source'], message: 'skip_must_be_null' })
    }
    if (payload.sleep_duration_source === 'intervals' && !intervalsOk) {
      ctx.addIssue({ code: 'custom', path: ['sleep_duration_source'], message: 'intervals_required' })
    }
    if (payload.sleep_duration_source === 'overall' && !overallOk) {
      ctx.addIssue({ code: 'custom', path: ['sleep_duration_source'], message: 'overall_required' })
    }

    refineAnsweredInteger(payload.fatigue_score, payload.fatigue_answer_status, 0, 10, 'fatigue_score', ctx)
    refineAnsweredInteger(payload.stress_score, payload.stress_answer_status, 0, 10, 'stress_score', ctx)

    const codes = payload.context.map((item) => item.code)
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: 'custom', path: ['context'], message: 'duplicate_context' })
    }

    if (payload.symptom_presence === 'yes') {
      if (payload.symptoms.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['symptoms'], message: 'symptoms_required' })
      }
    } else if (payload.symptoms.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['symptoms'], message: 'symptoms_must_be_empty' })
    }
  })

export type GeneralPayload = z.infer<typeof generalPayloadSchema>
export type NutritionPayload = z.infer<typeof nutritionPayloadSchema>

export function skippedNutrition(status: 'skipped' | 'not_applicable' = 'skipped'): NutritionPayload {
  return {
    section_status: status,
    appetite: null,
    appetite_answer_status: 'not_applicable',
    meal_plan: null,
    meal_plan_answer_status: 'not_applicable',
    missed_meals: null,
    missed_meals_answer_status: 'not_applicable',
    deviation_reason: null,
    deviation_reason_answer_status: 'not_applicable',
    fluid_ml: null,
    fluid_answer_status: 'not_applicable',
    fluid_completeness: null,
    comment: null,
    period_start: null,
    period_end: null,
  }
}

function refineAnsweredInteger(
  value: number | null,
  status: AnswerStatus,
  min: number,
  max: number,
  path: string,
  ctx: z.RefinementCtx,
  allowUnknown = false,
): void {
  if (allowUnknown && status === 'unknown') {
    if (value !== null) ctx.addIssue({ code: 'custom', path: [path], message: 'skip_must_be_null' })
    return
  }
  refineAnsweredStep(value, status, min, max, 1, path, ctx)
}

function refineAnsweredStep(
  value: number | null,
  status: AnswerStatus,
  min: number,
  max: number,
  denominator: number,
  path: string,
  ctx: z.RefinementCtx,
): void {
  if (status !== 'answered') {
    if (value !== null) {
      ctx.addIssue({ code: 'custom', path: [path], message: 'skip_must_be_null' })
    }
    return
  }
  if (value === null || !Number.isFinite(value) || value < min || value > max) {
    ctx.addIssue({ code: 'custom', path: [path], message: 'value_out_of_range' })
    return
  }
  const scaled = value * denominator
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
    ctx.addIssue({ code: 'custom', path: [path], message: 'value_step' })
  }
}

function refineOptionalChoice<T extends string>(
  value: T | null,
  status: AnswerStatus,
  allowed: readonly T[],
  path: string,
  ctx: z.RefinementCtx,
): void {
  if (status === 'answered') {
    if (value === null || !allowed.includes(value)) {
      ctx.addIssue({ code: 'custom', path: [path], message: 'required' })
    }
    return
  }
  if (value !== null) {
    ctx.addIssue({ code: 'custom', path: [path], message: 'skip_must_be_null' })
  }
}
