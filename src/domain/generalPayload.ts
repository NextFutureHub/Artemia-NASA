import { z } from 'zod'
import {
  ANSWER_STATUSES,
  CONTEXT_CODES,
  EMOTIONAL_STATES,
  IMPACT_VALUES,
  ONSET_CATEGORIES,
  OVERALL_STATES,
  PERSISTENCE_VALUES,
  SYMPTOM_CODES,
  SYMPTOM_PRESENCE,
  type AnswerStatus,
} from './enums.ts'

const answerStatusSchema = z.enum(ANSWER_STATUSES)

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

export const generalPayloadSchema = z
  .strictObject({
    overall_state: z.enum(OVERALL_STATES),
    sleep_hours: z.number().nullable(),
    sleep_answer_status: answerStatusSchema,
    sleep_quality: z.number().int().nullable(),
    sleep_quality_answer_status: answerStatusSchema,
    fatigue_score: z.number().int().nullable(),
    fatigue_answer_status: answerStatusSchema,
    stress_score: z.number().int().nullable(),
    stress_answer_status: answerStatusSchema,
    emotional_state: emotionalStateSchema,
    context: z.array(contextItemSchema).max(4),
    comment: z.string().min(1).max(1000).nullable(),
    symptom_presence: z.enum(SYMPTOM_PRESENCE),
    symptoms: z.array(symptomSchema).max(12),
    review_requested: z.boolean(),
  })
  .superRefine((payload, ctx) => {
    refineAnsweredStep(payload.sleep_hours, payload.sleep_answer_status, 0, 24, 2, 'sleep_hours', ctx)
    refineAnsweredInteger(payload.sleep_quality, payload.sleep_quality_answer_status, 1, 5, 'sleep_quality', ctx)
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

function refineAnsweredInteger(
  value: number | null,
  status: AnswerStatus,
  min: number,
  max: number,
  path: string,
  ctx: z.RefinementCtx,
): void {
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
