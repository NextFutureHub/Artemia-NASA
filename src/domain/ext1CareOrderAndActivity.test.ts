/**
 * EXT-1: care-order goal/start/review and unable decision.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildActivityPayload,
  linkActivityToCareOrder,
} from './activityPayload.ts'
import { buildCareOrderResponse, careOrderCardSchema, parseCareOrders } from './careOrder.ts'
import { CARE_ORDER_DECISIONS } from './enums.ts'

const orderId = '11111111-1111-4111-8111-111111111111'
const missionId = '22222222-2222-4222-8222-222222222222'
const responseId = '33333333-3333-4333-8333-333333333333'
const recordedAt = '2026-11-15T10:00:00.000Z'

test('care order card accepts optional goal and required start_at', () => {
  const card = {
    id: orderId,
    mission_id: missionId,
    subject_id: '44444444-4444-4444-8444-444444444444',
    assignment_id: '55555555-5555-4555-8555-555555555555',
    doctor_id: '66666666-6666-4666-8666-666666666666',
    kind: 'measurement',
    title: 'Pulse this evening',
    goal: 'Observe resting pulse',
    instructions: 'Enter a resting pulse before sleep.',
    schedule_text: 'Once today',
    start_at: '2026-11-15T08:00:00.000Z',
    review_at: '2026-11-20T08:00:00.000Z',
    due_at: '2026-11-16T20:00:00.000Z',
    status: 'active',
    revision_no: 1,
    cancelled_reason: null,
    revise_reason: null,
    ack_required: false,
    acknowledged_at: null,
    created_at: recordedAt,
    updated_at: recordedAt,
    prototype_limit: 'observation_task_not_prescription',
    events: [],
    responses: [],
  }
  const parsed = careOrderCardSchema.safeParse(card)
  assert.equal(parsed.success, true)
  if (!parsed.success) return
  assert.equal(parsed.data.goal, 'Observe resting pulse')
  assert.equal(parsed.data.start_at, '2026-11-15T08:00:00.000Z')
  assert.equal(parsed.data.review_at, '2026-11-20T08:00:00.000Z')
})

test('unable decision is a first-class care response', () => {
  assert.ok((CARE_ORDER_DECISIONS as readonly string[]).includes('unable'))
  const unable = buildCareOrderResponse({
    id: responseId,
    orderId,
    missionId,
    decision: 'unable',
    note: 'Equipment unavailable',
    linkNote: 'see measurement attempt',
    recordedAt,
    createdAtDevice: recordedAt,
  })
  assert.ok(unable.payload)
  assert.equal(unable.payload?.decision, 'unable')
  assert.equal(unable.payload?.link_note, 'see measurement attempt')
})

test('skipped care-order response stays skipped without inventing a done note', () => {
  const skipped = buildCareOrderResponse({
    id: responseId,
    orderId,
    missionId,
    decision: 'skipped',
    note: null,
    recordedAt,
    createdAtDevice: recordedAt,
  })
  assert.ok(skipped.payload)
  assert.equal(skipped.payload?.decision, 'skipped')
  assert.equal(skipped.payload?.note, null)
  assert.equal(skipped.payload?.link_note, null)
})

test('parseCareOrders drops invalid cards instead of inventing plan fields', () => {
  const items = parseCareOrders({
    items: [
      {
        id: orderId,
        mission_id: missionId,
        subject_id: '44444444-4444-4444-8444-444444444444',
        assignment_id: '55555555-5555-4555-8555-555555555555',
        doctor_id: '66666666-6666-4666-8666-666666666666',
        kind: 'recommendation',
        title: 'Hydration reminder',
        instructions: 'Drink water with meals.',
        schedule_text: 'Daily',
        start_at: recordedAt,
        due_at: null,
        status: 'active',
        revision_no: 1,
        cancelled_reason: null,
        revise_reason: null,
        ack_required: false,
        acknowledged_at: null,
        created_at: recordedAt,
        updated_at: recordedAt,
        prototype_limit: 'observation_task_not_prescription',
        events: [],
        responses: [],
      },
      { id: 'not-a-card', goal: 'fake' },
    ],
  })
  assert.equal(items.length, 1)
  assert.equal(items[0]?.kind, 'recommendation')
})

test('E09 skipped workout omits exertion severity as if session happened', () => {
  const activityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const built = buildActivityPayload({
    id: activityId,
    missionId,
    startedAt: recordedAt,
    activityType: 'aerobic',
    completion: 'skipped',
    actualDurationMin: 45,
    skipReason: 'no_equipment',
    exertion: 7,
    careOrderId: orderId,
    measurementIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  })
  assert.ok(built.payload)
  assert.equal(built.payload?.completion, 'skipped')
  assert.equal(built.payload?.actual_duration_min, 0)
  assert.equal(built.payload?.exertion, null)
  assert.equal(built.payload?.exertion_answer_status, 'not_applicable')
  assert.deepEqual(built.payload?.measurement_ids, [])
  assert.equal(built.payload?.skip_reason, 'no_equipment')
})

test('E10 workout from task shares one activity_id and one completion fact', () => {
  const activityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const built = buildActivityPayload({
    id: activityId,
    missionId,
    startedAt: recordedAt,
    activityType: 'strength',
    completion: 'full',
    plannedDurationMin: 40,
    actualDurationMin: 38,
    exertion: 6,
    careOrderId: orderId,
  })
  assert.ok(built.payload)
  assert.equal(built.payload?.id, activityId)
  assert.equal(built.payload?.care_order_id, orderId)
  const link = linkActivityToCareOrder(activityId, orderId)
  assert.equal(link.activity_id, activityId)
  assert.equal(link.care_order_id, orderId)
  assert.equal(link.completion_fact, 'single')
})

test('E11 standalone workout has no fictitious physician assignment', () => {
  const built = buildActivityPayload({
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    missionId,
    startedAt: recordedAt,
    activityType: 'other',
    completion: 'partial',
    actualDurationMin: 20,
    exertionDeclined: true,
  })
  assert.ok(built.payload)
  assert.equal(built.payload?.care_order_id, null)
  assert.equal(built.payload?.planned_duration_min, null)
  assert.equal(built.payload?.exertion, null)
  assert.equal(built.payload?.exertion_answer_status, 'declined')
})

test('care order card revise fields remain first-class on the card schema', () => {
  const card = {
    id: orderId,
    mission_id: missionId,
    subject_id: '44444444-4444-4444-8444-444444444444',
    assignment_id: '55555555-5555-4555-8555-555555555555',
    doctor_id: '66666666-6666-4666-8666-666666666666',
    kind: 'measurement',
    title: 'Pulse revised',
    goal: 'Updated resting pulse goal',
    instructions: 'Sit five minutes first.',
    schedule_text: 'Once today',
    start_at: '2026-11-15T09:00:00.000Z',
    review_at: '2026-11-21T09:00:00.000Z',
    due_at: '2026-11-16T20:00:00.000Z',
    status: 'active',
    revision_no: 2,
    cancelled_reason: null,
    revise_reason: 'Clarify rest context',
    ack_required: true,
    acknowledged_at: null,
    created_at: recordedAt,
    updated_at: recordedAt,
    prototype_limit: 'observation_task_not_prescription',
    events: [],
    responses: [],
  }
  const parsed = careOrderCardSchema.safeParse(card)
  assert.equal(parsed.success, true)
  if (!parsed.success) return
  assert.equal(parsed.data.goal, 'Updated resting pulse goal')
  assert.equal(parsed.data.start_at, '2026-11-15T09:00:00.000Z')
  assert.equal(parsed.data.review_at, '2026-11-21T09:00:00.000Z')
  assert.equal(parsed.data.revision_no, 2)
})
