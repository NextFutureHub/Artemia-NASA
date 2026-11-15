import { z } from 'zod'
import { CARE_ORDER_DECISIONS, CARE_ORDER_KINDS, CARE_ORDER_STATUSES } from './enums.ts'
import { SCHEMA_VERSION } from './schemaVersion.ts'

const uuidSchema = z.uuid()
const timestampSchema = z.iso.datetime({ offset: true })

export const careOrderResponsePayloadSchema = z.strictObject({
  id: uuidSchema,
  order_id: uuidSchema,
  mission_id: uuidSchema,
  decision: z.enum(CARE_ORDER_DECISIONS),
  note: z.string().min(1).max(1000).nullable(),
  link_note: z.string().min(1).max(300).nullable(),
  /** Shared with activity payload id when completing a workout care task (E10). */
  activity_id: uuidSchema.nullable(),
  recorded_at: timestampSchema,
  created_at_device: timestampSchema,
})

export type CareOrderResponsePayload = z.infer<typeof careOrderResponsePayloadSchema>

export const careOrderCardSchema = z.object({
  id: uuidSchema,
  mission_id: uuidSchema,
  subject_id: uuidSchema,
  assignment_id: uuidSchema,
  doctor_id: uuidSchema,
  kind: z.enum(CARE_ORDER_KINDS),
  title: z.string().min(1).max(120),
  goal: z.string().max(500).nullable().optional(),
  instructions: z.string().min(1).max(3000),
  schedule_text: z.string().max(500),
  start_at: timestampSchema.nullable().optional(),
  review_at: timestampSchema.nullable().optional(),
  due_at: timestampSchema.nullable(),
  status: z.enum(CARE_ORDER_STATUSES),
  revision_no: z.number().int().min(1),
  cancelled_reason: z.string().nullable(),
  revise_reason: z.string().nullable(),
  ack_required: z.boolean(),
  acknowledged_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  prototype_limit: z.literal('observation_task_not_prescription'),
  events: z.array(
    z.object({
      event_type: z.string(),
      actor_id: uuidSchema,
      detail: z.string().nullable(),
      server_at: timestampSchema,
    }),
  ),
  responses: z.array(
    z.object({
      id: uuidSchema,
      decision: z.enum(CARE_ORDER_DECISIONS),
      note: z.string().nullable(),
      link_note: z.string().nullable().optional(),
      recorded_at: timestampSchema,
    }),
  ),
})

export type CareOrderCard = z.infer<typeof careOrderCardSchema>

export function parseCareOrders(body: unknown): CareOrderCard[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { items?: unknown }).items)) return []
  return (body as { items: unknown[] }).items.flatMap((item) => {
    const parsed = careOrderCardSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

export function buildCareOrderResponse(input: {
  id: string
  orderId: string
  missionId: string
  decision: (typeof CARE_ORDER_DECISIONS)[number]
  note: string | null
  linkNote?: string | null
  activityId?: string | null
  recordedAt: string
  createdAtDevice: string
}): { payload: CareOrderResponsePayload | null; issues: string[] } {
  const parsed = careOrderResponsePayloadSchema.safeParse({
    id: input.id,
    order_id: input.orderId,
    mission_id: input.missionId,
    decision: input.decision,
    note: input.note,
    link_note: input.linkNote ?? null,
    activity_id: input.activityId ?? null,
    recorded_at: input.recordedAt,
    created_at_device: input.createdAtDevice,
  })
  if (!parsed.success) return { payload: null, issues: parsed.error.issues.map((item) => item.message) }
  return { payload: parsed.data, issues: [] }
}

export const CARE_ORDER_SCHEMA_VERSION = SCHEMA_VERSION
