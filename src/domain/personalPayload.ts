import { z } from 'zod'
import {
  ANSWER_STATUSES,
  BLEEDING_CATEGORIES,
  BLEEDING_INTENSITIES,
  CYCLE_CONTEXTS,
  EXPECTEDNESS_VALUES,
  IMPACT_VALUES,
  PLAN_ADHERENCE,
  type AnswerStatus,
} from './enums.ts'

const answerStatusSchema = z.enum(ANSWER_STATUSES)

export const personalPayloadSchema = z
  .strictObject({
    bleeding_category: z.enum(BLEEDING_CATEGORIES).nullable(),
    bleeding_category_answer_status: answerStatusSchema,
    bleeding_intensity: z.enum(BLEEDING_INTENSITIES).nullable(),
    bleeding_intensity_answer_status: answerStatusSchema,
    expectedness: z.enum(EXPECTEDNESS_VALUES).nullable(),
    expectedness_answer_status: answerStatusSchema,
    discomfort_score: z.number().int().nullable(),
    discomfort_answer_status: answerStatusSchema,
    activity_impact: z.enum(IMPACT_VALUES).nullable(),
    activity_impact_answer_status: answerStatusSchema,
    cycle_context: z.enum(CYCLE_CONTEXTS).nullable(),
    cycle_context_answer_status: answerStatusSchema,
    prescribed_plan_adherence: z.enum(PLAN_ADHERENCE).nullable(),
    prescribed_plan_adherence_answer_status: answerStatusSchema,
    review_requested: z.boolean(),
    comment: z.string().min(1).max(1000).nullable(),
    comment_answer_status: answerStatusSchema,
  })
  .superRefine((payload, ctx) => {
    refineNullableAnswer(payload.bleeding_category, payload.bleeding_category_answer_status, 'bleeding_category', ctx)
    refineNullableAnswer(payload.expectedness, payload.expectedness_answer_status, 'expectedness', ctx)
    refineNullableAnswer(payload.activity_impact, payload.activity_impact_answer_status, 'activity_impact', ctx)
    refineNullableAnswer(payload.cycle_context, payload.cycle_context_answer_status, 'cycle_context', ctx)
    refineNullableAnswer(payload.comment, payload.comment_answer_status, 'comment', ctx)
    refineScore(payload.discomfort_score, payload.discomfort_answer_status, ctx)

    const bleedingAnswered =
      payload.bleeding_category_answer_status === 'answered' && payload.bleeding_category !== null
    const intensityApplies =
      bleedingAnswered &&
      (payload.bleeding_category === 'spotting' ||
        payload.bleeding_category === 'menstrual' ||
        payload.bleeding_category === 'other')

    if (!intensityApplies) {
      if (payload.bleeding_intensity !== null || payload.bleeding_intensity_answer_status !== 'not_applicable') {
        ctx.addIssue({
          code: 'custom',
          path: ['bleeding_intensity'],
          message: 'intensity_not_applicable',
        })
      }
    } else {
      refineNullableAnswer(
        payload.bleeding_intensity,
        payload.bleeding_intensity_answer_status,
        'bleeding_intensity',
        ctx,
      )
      if (payload.bleeding_intensity_answer_status === 'not_applicable') {
        ctx.addIssue({
          code: 'custom',
          path: ['bleeding_intensity_answer_status'],
          message: 'intensity_required_or_skipped',
        })
      }
    }

    const adherenceApplies =
      payload.cycle_context_answer_status === 'answered' && payload.cycle_context === 'suppression_regimen'
    if (!adherenceApplies) {
      if (
        payload.prescribed_plan_adherence !== null ||
        payload.prescribed_plan_adherence_answer_status !== 'not_applicable'
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['prescribed_plan_adherence'],
          message: 'adherence_not_applicable',
        })
      }
    } else {
      refineNullableAnswer(
        payload.prescribed_plan_adherence,
        payload.prescribed_plan_adherence_answer_status,
        'prescribed_plan_adherence',
        ctx,
      )
      if (payload.prescribed_plan_adherence_answer_status === 'not_applicable') {
        ctx.addIssue({
          code: 'custom',
          path: ['prescribed_plan_adherence_answer_status'],
          message: 'adherence_required_or_skipped',
        })
      }
    }
  })

export type PersonalPayload = z.infer<typeof personalPayloadSchema>

function refineNullableAnswer(
  value: unknown,
  status: AnswerStatus,
  path: string,
  ctx: z.RefinementCtx,
): void {
  if (status === 'answered' && value === null) {
    ctx.addIssue({ code: 'custom', path: [path], message: 'answered_value_required' })
  }
  if (status !== 'answered' && value !== null) {
    ctx.addIssue({ code: 'custom', path: [path], message: 'skip_must_be_null' })
  }
}

function refineScore(value: number | null, status: AnswerStatus, ctx: z.RefinementCtx): void {
  if (status !== 'answered') {
    if (value !== null) {
      ctx.addIssue({ code: 'custom', path: ['discomfort_score'], message: 'skip_must_be_null' })
    }
    return
  }
  if (value === null || !Number.isInteger(value) || value < 0 || value > 10) {
    ctx.addIssue({ code: 'custom', path: ['discomfort_score'], message: 'value_out_of_range' })
  }
}
