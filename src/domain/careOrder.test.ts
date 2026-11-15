import assert from 'node:assert/strict'
import test from 'node:test'
import { hashOperation } from './canonicalJson.ts'
import { buildCareOrderResponse, parseCareOrders } from './careOrder.ts'

const orderId = '11111111-1111-4111-8111-111111111111'
const missionId = '22222222-2222-4222-8222-222222222222'
const responseId = '33333333-3333-4333-8333-333333333333'
const recordedAt = '2026-11-15T10:00:00.000Z'

test('care order response schema accepts done/skip/ack/unable and rejects empty note strings', () => {
  const done = buildCareOrderResponse({
    id: responseId,
    orderId,
    missionId,
    decision: 'done',
    note: 'Resting pulse entered',
    recordedAt,
    createdAtDevice: recordedAt,
  })
  assert.ok(done.payload)
  assert.equal(done.payload?.decision, 'done')
  assert.equal(done.payload?.link_note, null)

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

  const ack = buildCareOrderResponse({
    id: responseId,
    orderId,
    missionId,
    decision: 'acknowledged',
    note: null,
    recordedAt,
    createdAtDevice: recordedAt,
  })
  assert.ok(ack.payload)

  const unable = buildCareOrderResponse({
    id: responseId,
    orderId,
    missionId,
    decision: 'unable',
    note: 'No equipment',
    linkNote: null,
    recordedAt,
    createdAtDevice: recordedAt,
  })
  assert.ok(unable.payload)
  assert.equal(unable.payload?.decision, 'unable')

  const bad = buildCareOrderResponse({
    id: responseId,
    orderId,
    missionId,
    decision: 'done',
    note: '',
    recordedAt,
    createdAtDevice: recordedAt,
  })
  assert.equal(bad.payload, null)
})

test('care order response hash is stable for the same payload', async () => {
  const built = buildCareOrderResponse({
    id: responseId,
    orderId,
    missionId,
    decision: 'done',
    note: null,
    recordedAt,
    createdAtDevice: recordedAt,
  })
  assert.ok(built.payload)
  const first = await hashOperation({ schemaVersion: 1, type: 'care_order_response', payload: built.payload })
  const second = await hashOperation({ schemaVersion: 1, type: 'care_order_response', payload: built.payload })
  assert.equal(first, second)
  assert.match(first, /^[0-9a-f]{64}$/)
})

test('parseCareOrders keeps only valid cards with prototype limit', () => {
  const items = parseCareOrders({
    items: [
      {
        id: orderId,
        mission_id: missionId,
        subject_id: '44444444-4444-4444-8444-444444444444',
        assignment_id: '55555555-5555-4555-8555-555555555555',
        doctor_id: '66666666-6666-4666-8666-666666666666',
        kind: 'measurement',
        title: 'Pulse this evening',
        instructions: 'Enter a resting pulse before sleep.',
        schedule_text: 'Once today',
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
      },
      { id: 'bad' },
    ],
  })
  assert.equal(items.length, 1)
  assert.equal(items[0]?.prototype_limit, 'observation_task_not_prescription')
  assert.equal(items[0]?.kind, 'measurement')
})
