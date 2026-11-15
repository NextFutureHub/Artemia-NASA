import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildActivityPayload } from '../../domain/activityPayload.ts'
import { ArtemiaDb } from './db.ts'
import { commitActivity, listActivities, readActivity } from './activities.ts'
import type { LocalCareOrder, PreparedProfile } from './types.ts'

const OWNER = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const MISSION = '11111111-1111-4111-8111-111111111111'
const ORDER = '44444444-4444-4444-8444-444444444444'
const ENV = 'demo'
const STARTED = '2026-11-15T10:00:00.000Z'

test('E11 standalone activity commits locally without inventing a care order or outbox row', async () => {
  const database = new ArtemiaDb(`artemia-activity-${crypto.randomUUID()}`)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await seedProfile(database)
  const activityId = crypto.randomUUID()
  const operationId = crypto.randomUUID()
  const built = buildActivityPayload({
    id: activityId,
    missionId: MISSION,
    startedAt: STARTED,
    activityType: 'other',
    completion: 'partial',
    actualDurationMin: 20,
    exertionDeclined: true,
  })
  assert.ok(built.payload)
  assert.equal(built.payload.care_order_id, null)

  const saved = await commitActivity(database, scope, {
    operationId,
    payload: built.payload,
    careOrder: null,
  })
  assert.equal(saved.status, 'committed')
  if (saved.status !== 'committed') return
  assert.equal(saved.delivery, 'local_only')
  assert.equal(saved.careResponseQueued, false)
  assert.equal(await database.outbox.count(), 0)
  assert.equal(await database.localCareOrders.count(), 0)

  const again = await commitActivity(database, scope, {
    operationId,
    payload: built.payload,
    careOrder: null,
  })
  assert.equal(again.status, 'committed')
  assert.equal(await database.localActivities.count(), 1)

  const row = await readActivity(database, scope, activityId)
  assert.equal(row?.payload.exertion, null)
  assert.equal(row?.payload.exertion_answer_status, 'declined')
  assert.equal(await readActivity(database, { ownerId: OTHER, environmentId: ENV }, activityId), null)
  assert.equal((await listActivities(database, { ownerId: OTHER, environmentId: ENV })).length, 0)

  database.close()
  await database.delete()
})

test('E09 skipped activity from task omits RPE and queues one care_order_response with activity_id', async () => {
  const database = new ArtemiaDb(`artemia-activity-${crypto.randomUUID()}`)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await seedProfile(database)
  const order = careOrder()
  await database.localCareOrders.put(order)

  const activityId = crypto.randomUUID()
  const operationId = crypto.randomUUID()
  const responseOperationId = crypto.randomUUID()
  const built = buildActivityPayload({
    id: activityId,
    missionId: MISSION,
    startedAt: STARTED,
    activityType: 'aerobic',
    completion: 'skipped',
    actualDurationMin: 45,
    skipReason: 'no_equipment',
    exertion: 7,
    careOrderId: ORDER,
    plannedDurationMin: 30,
    measurementIds: [],
  })
  assert.ok(built.payload)
  assert.equal(built.payload.exertion, null)
  assert.equal(built.payload.exertion_answer_status, 'not_applicable')
  assert.equal(built.payload.actual_duration_min, 0)

  const saved = await commitActivity(database, scope, {
    operationId,
    payload: built.payload,
    careOrder: order,
    responseOperationId,
  })
  assert.equal(saved.status, 'committed')
  if (saved.status !== 'committed') return
  assert.equal(saved.careResponseQueued, true)
  assert.equal(await database.outbox.count(), 1)

  const outbox = (await database.outbox.toArray())[0]
  assert.equal(outbox?.entity_type, 'care_order_response')
  const frozen = outbox?.frozen_payload as { activity_id?: string; decision?: string; order_id?: string }
  assert.equal(frozen.activity_id, activityId)
  assert.equal(frozen.decision, 'skipped')
  assert.equal(frozen.order_id, ORDER)

  const updated = await database.localCareOrders.get(ORDER)
  assert.equal(updated?.status, 'completed')
  assert.equal(updated?.last_decision, 'skipped')

  database.close()
  await database.delete()
})

test('E10 full workout from task shares one activity_id as the care completion fact', async () => {
  const database = new ArtemiaDb(`artemia-activity-${crypto.randomUUID()}`)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await seedProfile(database)
  const order = careOrder()
  await database.localCareOrders.put(order)

  const activityId = crypto.randomUUID()
  const built = buildActivityPayload({
    id: activityId,
    missionId: MISSION,
    startedAt: STARTED,
    activityType: 'strength',
    completion: 'full',
    plannedDurationMin: 40,
    actualDurationMin: 38,
    exertion: 6,
    careOrderId: ORDER,
  })
  assert.ok(built.payload)

  const saved = await commitActivity(database, scope, {
    operationId: crypto.randomUUID(),
    payload: built.payload,
    careOrder: order,
    responseOperationId: crypto.randomUUID(),
  })
  assert.equal(saved.status, 'committed')
  const frozen = (await database.outbox.toArray())[0]?.frozen_payload as { activity_id?: string; decision?: string }
  assert.equal(frozen.activity_id, activityId)
  assert.equal(frozen.decision, 'done')
  assert.equal((await readActivity(database, scope, activityId))?.id, activityId)

  database.close()
  await database.delete()
})

test('same operation id with a different activity payload conflicts', async () => {
  const database = new ArtemiaDb(`artemia-activity-${crypto.randomUUID()}`)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await seedProfile(database)
  const first = buildActivityPayload({
    id: crypto.randomUUID(),
    missionId: MISSION,
    startedAt: STARTED,
    activityType: 'aerobic',
    completion: 'full',
    actualDurationMin: 10,
    exertion: 3,
  })
  assert.ok(first.payload)
  const operationId = crypto.randomUUID()
  assert.equal(
    (await commitActivity(database, scope, { operationId, payload: first.payload, careOrder: null })).status,
    'committed',
  )
  const second = buildActivityPayload({
    id: crypto.randomUUID(),
    missionId: MISSION,
    startedAt: STARTED,
    activityType: 'aerobic',
    completion: 'full',
    actualDurationMin: 12,
    exertion: 4,
  })
  assert.ok(second.payload)
  const conflict = await commitActivity(database, scope, {
    operationId,
    payload: second.payload,
    careOrder: null,
  })
  assert.equal(conflict.status, 'conflict')
  assert.equal(await database.localActivities.count(), 1)

  database.close()
  await database.delete()
})

async function seedProfile(database: ArtemiaDb): Promise<void> {
  const profile: PreparedProfile = {
    owner_id: OWNER,
    environment_id: ENV,
    display_name: 'Mira Example',
    callsign: 'Mira-01',
    mission_id: MISSION,
    role: 'astronaut',
    locale: 'ru',
    timezone: 'UTC',
    reminder_time: null,
    reminder_enabled: false,
    reminder_last_local_date: null,
    reproductive_enabled: false,
    sensitive_sharing: 'device_only',
    general_exchange: true,
    unit_system: 'metric',
    age: null,
    sex_context: null,
    device_id: '55555555-5555-4555-8555-555555555555',
    demo_dataset_id: null,
    prepared_at: STARTED,
    schema_version: 1,
    storage_persisted: true,
  }
  await database.preparedProfiles.put(profile)
}

function careOrder(): LocalCareOrder {
  return {
    id: ORDER,
    owner_id: OWNER,
    environment_id: ENV,
    mission_id: MISSION,
    assignment_id: '66666666-6666-4666-8666-666666666666',
    doctor_id: '77777777-7777-4777-8777-777777777777',
    kind: 'workout',
    title: 'Evening bike',
    goal: 'Keep aerobic load',
    instructions: '20–40 min moderate',
    schedule_text: '30 min',
    start_at: STARTED,
    review_at: null,
    due_at: null,
    status: 'active',
    revision_no: 1,
    cancelled_reason: null,
    revise_reason: null,
    ack_required: false,
    acknowledged_at: null,
    created_at: STARTED,
    updated_at: STARTED,
    last_decision: null,
    last_note: null,
    last_response_at: null,
  }
}
