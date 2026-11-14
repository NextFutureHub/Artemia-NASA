import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCareOrderResponse } from '../../domain/careOrder.ts'
import { ArtemiaDb } from './db.ts'
import { commitCareOrderResponse, listCareOrders, replaceCareOrders } from './careOrders.ts'
import type { CareOrderCard } from '../../domain/careOrder.ts'

const OWNER = '22222222-2222-4222-8222-222222222222'
const ENV = 'demo'
const ORDER = '11111111-1111-4111-8111-111111111111'
const MISSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const recordedAt = '2026-11-15T10:00:00.000Z'

function card(): CareOrderCard {
  return {
    id: ORDER,
    mission_id: MISSION,
    subject_id: OWNER,
    assignment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    doctor_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
  }
}

test('double submit of care_order_response keeps one outbox row for the same operation id', async () => {
  const database = new ArtemiaDb(`artemia-care-${crypto.randomUUID()}`)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await replaceCareOrders(database, scope, [card()])
  const rows = await listCareOrders(database, scope)
  assert.equal(rows.length, 1)
  const order = rows[0]!
  const built = buildCareOrderResponse({
    id: '33333333-3333-4333-8333-333333333333',
    orderId: ORDER,
    missionId: MISSION,
    decision: 'done',
    note: null,
    recordedAt,
    createdAtDevice: recordedAt,
  })
  assert.ok(built.payload)
  const operationId = '44444444-4444-4444-8444-444444444444'
  const first = await commitCareOrderResponse(database, scope, order, built.payload, operationId)
  const again = await commitCareOrderResponse(database, scope, order, built.payload, operationId)
  assert.equal(first.status, 'committed')
  assert.equal(again.status, 'committed')
  assert.equal(await database.outbox.count(), 1)
  assert.equal(await database.receipts.count(), 1)
  const updated = await listCareOrders(database, scope)
  assert.equal(updated[0]?.status, 'completed')
  assert.equal(updated[0]?.last_decision, 'done')
  database.close()
  await database.delete()
})
