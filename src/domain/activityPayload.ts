/**
 * EXT-1 activity payload builders: skip without RPE, task linkage, standalone.
 */

import { z } from 'zod'

export const ACTIVITY_TYPES = ['aerobic', 'strength', 'other'] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const ACTIVITY_COMPLETION = ['full', 'partial', 'skipped'] as const
export type ActivityCompletion = (typeof ACTIVITY_COMPLETION)[number]

export const ACTIVITY_SKIP_REASONS = ['no_time', 'no_equipment', 'wellbeing', 'other', 'declined'] as const
export type ActivitySkipReason = (typeof ACTIVITY_SKIP_REASONS)[number]

const uuidSchema = z.uuid()
const timestampSchema = z.iso.datetime({ offset: true })

export const activityPayloadSchema = z
  .strictObject({
    id: uuidSchema,
    mission_id: uuidSchema,
    started_at: timestampSchema,
    activity_type: z.enum(ACTIVITY_TYPES),
    completion: z.enum(ACTIVITY_COMPLETION),
    planned_duration_min: z.number().int().min(0).nullable(),
    actual_duration_min: z.number().int().min(0),
    skip_reason: z.enum(ACTIVITY_SKIP_REASONS).nullable(),
    exertion: z.number().int().min(0).max(10).nullable(),
    exertion_answer_status: z.enum(['answered', 'declined', 'not_applicable']),
    care_order_id: uuidSchema.nullable(),
    measurement_ids: z.array(uuidSchema).max(20),
    comment: z.string().min(1).max(1000).nullable(),
  })
  .superRefine((payload, ctx) => {
    if (payload.care_order_id === null && payload.planned_duration_min !== null) {
      ctx.addIssue({ code: 'custom', path: ['planned_duration_min'], message: 'standalone_no_plan' })
    }
    if (payload.completion === 'skipped') {
      if (payload.actual_duration_min !== 0) {
        ctx.addIssue({ code: 'custom', path: ['actual_duration_min'], message: 'skipped_duration_must_be_zero' })
      }
      if (payload.exertion !== null) {
        ctx.addIssue({ code: 'custom', path: ['exertion'], message: 'skipped_omits_exertion' })
      }
      if (payload.exertion_answer_status !== 'not_applicable') {
        ctx.addIssue({
          code: 'custom',
          path: ['exertion_answer_status'],
          message: 'skipped_exertion_not_applicable',
        })
      }
      if (payload.measurement_ids.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['measurement_ids'], message: 'skipped_omits_measurements' })
      }
      if (payload.skip_reason === null) {
        ctx.addIssue({ code: 'custom', path: ['skip_reason'], message: 'skip_reason_required' })
      }
    } else {
      if (payload.actual_duration_min <= 0) {
        ctx.addIssue({ code: 'custom', path: ['actual_duration_min'], message: 'duration_required' })
      }
      if (payload.skip_reason !== null) {
        ctx.addIssue({ code: 'custom', path: ['skip_reason'], message: 'skip_reason_forbidden' })
      }
      if (payload.exertion_answer_status === 'answered' && payload.exertion === null) {
        ctx.addIssue({ code: 'custom', path: ['exertion'], message: 'exertion_required' })
      }
      if (payload.exertion_answer_status !== 'answered' && payload.exertion !== null) {
        ctx.addIssue({ code: 'custom', path: ['exertion'], message: 'exertion_must_be_null' })
      }
      if (payload.exertion_answer_status === 'not_applicable') {
        ctx.addIssue({
          code: 'custom',
          path: ['exertion_answer_status'],
          message: 'not_applicable_only_when_skipped',
        })
      }
    }
  })

export type ActivityPayload = z.infer<typeof activityPayloadSchema>

export type BuildActivityInput = {
  id: string
  missionId: string
  startedAt: string
  activityType: ActivityType
  completion: ActivityCompletion
  plannedDurationMin?: number | null
  actualDurationMin: number
  skipReason?: ActivitySkipReason | null
  exertion?: number | null
  exertionDeclined?: boolean
  careOrderId?: string | null
  measurementIds?: string[]
  comment?: string | null
}

export function buildActivityPayload(input: BuildActivityInput): {
  payload: ActivityPayload | null
  issues: string[]
} {
  const skipped = input.completion === 'skipped'
  const exertionDeclined = input.exertionDeclined === true
  const parsed = activityPayloadSchema.safeParse({
    id: input.id,
    mission_id: input.missionId,
    started_at: input.startedAt,
    activity_type: input.activityType,
    completion: input.completion,
    planned_duration_min: input.careOrderId ? (input.plannedDurationMin ?? null) : null,
    actual_duration_min: skipped ? 0 : input.actualDurationMin,
    skip_reason: skipped ? (input.skipReason ?? null) : null,
    exertion: skipped ? null : exertionDeclined ? null : (input.exertion ?? null),
    exertion_answer_status: skipped
      ? 'not_applicable'
      : exertionDeclined
        ? 'declined'
        : input.exertion === null || input.exertion === undefined
          ? 'declined'
          : 'answered',
    care_order_id: input.careOrderId ?? null,
    measurement_ids: skipped ? [] : (input.measurementIds ?? []),
    comment: input.comment ?? null,
  })
  if (!parsed.success) {
    return { payload: null, issues: parsed.error.issues.map((item) => item.message) }
  }
  return { payload: parsed.data, issues: [] }
}

/** Completing a care-order workout links one activity_id as the completion fact. */
export function linkActivityToCareOrder(activityId: string, careOrderId: string): {
  activity_id: string
  care_order_id: string
  completion_fact: 'single'
} {
  return { activity_id: activityId, care_order_id: careOrderId, completion_fact: 'single' }
}
