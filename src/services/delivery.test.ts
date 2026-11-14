import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ArtemiaDb } from '../data/local/db.ts'
import type { LocalCheckin, OutboxItem } from '../data/local/types.ts'
import { personalSendBlocked, runDelivery, type OperationResponse } from './delivery.ts'

const OWNER = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const ENV = 'demo'
const HASH = 'a'.repeat(64)
const NOW = '2026-11-14T12:00:00.000Z'

test('a lost response then the same receipt does not create a second operation', async () => {
  const database = await seeded()
  await database.outbox.put(item('op-1', 'pending'))
  await database.localCheckins.put(checkin('entity-1'))
  await database.receipts.put({
    operation_id: 'op-1',
    owner_id: OWNER,
    environment_id: ENV,
    entity_type: 'checkin_bundle',
    entity_id: 'entity-1',
    payload_hash: HASH,
    local_committed_at: NOW,
    server_receipt_id: null,
  })
  let calls = 0
  const post = async (): Promise<OperationResponse> => {
    calls += 1
    if (calls === 1) return { status: 0, body: null, retryAfterSeconds: null }
    return { status: 200, body: { status: 'duplicate', receipt_id: 'receipt-1', payload_hash: HASH, error_code: null }, retryAfterSeconds: null }
  }
  await deliver(database, post, false)
  assert.equal((await database.outbox.get('op-1'))?.state, 'retry_wait')
  assert.equal((await database.receipts.get('op-1'))?.server_receipt_id ?? null, null)
  await deliver(database, post, true)
  assert.equal(calls, 2)
  assert.equal(await database.outbox.count(), 1)
  assert.equal((await database.outbox.get('op-1'))?.state, 'accepted')
  assert.equal((await database.receipts.get('op-1'))?.server_receipt_id, 'receipt-1')
  assert.equal((await database.localCheckins.get('entity-1'))?.delivery, 'accepted')
  await database.delete()
})

test('401 stays blocked until a manual retry and 403 does not retry', async () => {
  const database = await seeded()
  await database.outbox.put(item('auth', 'pending'))
  await database.outbox.put(item('denied', 'pending', { created_at: '2026-11-14T12:00:01.000Z' }))
  const codes: number[] = []
  await deliver(database, async (body) => {
    const operation = body as { operation_id: string }
    codes.push(operation.operation_id === 'auth' ? 401 : 403)
    return operation.operation_id === 'auth'
      ? { status: 401, body: { status: 'forbidden', error_code: 'not_authenticated' }, retryAfterSeconds: null }
      : { status: 403, body: { status: 'forbidden', error_code: 'not_mission_astronaut' }, retryAfterSeconds: null }
  }, false)
  assert.equal((await database.outbox.get('auth'))?.state, 'blocked_auth')
  assert.equal((await database.outbox.get('denied'))?.state, 'blocked_permission')
  const before = codes.length
  await deliver(database, async () => accepted('nope'), false)
  assert.equal(codes.length, before)
  await database.delete()
})

test('another user does not send the queue', async () => {
  const database = await seeded()
  await database.outbox.put(item('op-1', 'pending'))
  let calls = 0
  await runDelivery({
    database,
    scope: { ownerId: OWNER, environmentId: ENV },
    sessionUserId: OTHER,
    token: 'token',
    manual: true,
    now: () => NOW,
    random: () => 0.5,
    postOperation: async () => {
      calls += 1
      return accepted('receipt-1')
    },
    pullChanges: async () => ({ status: 200, body: { events: [], next_cursor: '0' }, retryAfterSeconds: null }),
    refreshSession: async () => false,
    refreshCareOrders: async () => undefined,
  })
  assert.equal(calls, 0)
  assert.equal((await database.outbox.get('op-1'))?.state, 'pending')
  await database.delete()
})

test('a validation error does not block an independent operation', async () => {
  const database = await seeded()
  await database.outbox.put(item('bad', 'pending'))
  await database.outbox.put(item('good', 'pending', { created_at: '2026-11-14T12:00:02.000Z' }))
  const sent: string[] = []
  await deliver(database, async (body) => {
    const operation = body as { operation_id: string }
    sent.push(operation.operation_id)
    if (operation.operation_id === 'bad') return { status: 422, body: { status: 'validation_error', error_code: 'hash_format' }, retryAfterSeconds: null }
    return accepted('receipt-good')
  }, false)
  assert.deepEqual(sent, ['bad', 'good'])
  assert.equal((await database.outbox.get('bad'))?.state, 'validation_error')
  assert.equal((await database.outbox.get('good'))?.state, 'accepted')
  await database.delete()
})

test('conflict keeps the frozen payload and a dependent waits', async () => {
  const database = await seeded()
  const measurement = item('measure', 'pending', { entity_type: 'measurement' })
  const checkin = item('checkin', 'pending', { dependencies: ['measure'], created_at: '2026-11-14T12:00:03.000Z', frozen_payload: { comment: 'Самочувствие', personal: null } })
  await database.outbox.bulkPut([measurement, checkin])
  await deliver(database, async (body) => {
    const operation = body as { operation_id: string }
    if (operation.operation_id === 'measure') return { status: 409, body: { status: 'conflict', error_code: 'parent_revision_conflict' }, retryAfterSeconds: null }
    return accepted('should-not')
  }, false)
  assert.equal((await database.outbox.get('measure'))?.state, 'conflict')
  const kept = await database.outbox.get('checkin')
  assert.equal(kept?.state, 'pending')
  assert.deepEqual(kept?.frozen_payload, checkin.frozen_payload)
  await database.delete()
})

test('two overlapping runs send one operation once', async () => {
  const database = await seeded()
  await database.outbox.put(item('op-1', 'pending'))
  let calls = 0
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const post = async (): Promise<OperationResponse> => {
    calls += 1
    if (calls === 1) await gate
    return accepted('receipt-1')
  }
  const first = deliver(database, post, false)
  await new Promise((resolve) => setTimeout(resolve, 30))
  const second = deliver(database, post, false)
  release()
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.equal(await database.outbox.count(), 1)
  await database.delete()
})

test('429 and 500 wait to retry and do not mark a receipt', async () => {
  const database = await seeded()
  await database.outbox.put(item('slow', 'pending'))
  await database.outbox.put(item('down', 'pending', { created_at: '2026-11-14T12:00:04.000Z' }))
  await deliver(database, async (body) => {
    const operation = body as { operation_id: string }
    if (operation.operation_id === 'slow') return { status: 429, body: null, retryAfterSeconds: 9 }
    return { status: 500, body: null, retryAfterSeconds: null }
  }, false)
  const slow = await database.outbox.get('slow')
  const down = await database.outbox.get('down')
  assert.equal(slow?.state, 'retry_wait')
  assert.equal(down?.state, 'retry_wait')
  assert.ok(Date.parse(slow?.next_attempt_at ?? '') - Date.parse(NOW) >= 9_000)
  assert.ok(Date.parse(down?.next_attempt_at ?? '') - Date.parse(NOW) === 2_000)
  assert.equal(await database.receipts.count(), 0)
  await database.delete()
})

test('pull advances the cursor only with the returned events', async () => {
  const database = await seeded()
  await deliver(database, async () => accepted('unused'), false, {
    pullChanges: async (cursor) => {
      assert.equal(cursor, '0')
      return { status: 200, body: { events: [{ entity_id: 'server-op', position: 4 }], next_cursor: '4' }, retryAfterSeconds: null }
    },
  })
  const cursor = await database.syncCursors.toArray()
  assert.equal(cursor[0]?.scope, '4')
  const audit = await database.localAudit.toArray()
  assert.equal(audit.some((row) => row.event_code === 'pull_seen' && row.entity_id === 'server-op'), true)
  await database.delete()
})

test('a consented personal part can be sent and a leak in the general snapshot cannot', () => {
  assert.equal(personalSendBlocked({ personal: null }), false)
  assert.equal(personalSendBlocked({ personal: { consent_event_id: '10000000-0000-4000-8000-000000000401', personal_payload: { bleeding_category: 'none' } } }), false)
  assert.equal(personalSendBlocked({ personal: { personal_payload: { bleeding_category: 'none' } } }), true)
  assert.equal(personalSendBlocked({ revision: { general_payload: { bleeding_category: 'none' } }, personal: null }), true)
})

test('care-order refresh failure does not block outbox acceptance', async () => {
  const database = await seeded()
  await database.outbox.put(item('op-1', 'pending'))
  await database.localCheckins.put(checkin('entity-1'))
  await database.receipts.put({
    operation_id: 'op-1',
    owner_id: OWNER,
    environment_id: ENV,
    entity_type: 'checkin_bundle',
    entity_id: 'entity-1',
    payload_hash: HASH,
    local_committed_at: NOW,
    server_receipt_id: null,
  })
  let careCalls = 0
  await runDelivery({
    database,
    scope: { ownerId: OWNER, environmentId: ENV },
    sessionUserId: OWNER,
    token: 'token',
    manual: true,
    now: () => NOW,
    random: () => 0.5,
    postOperation: async () => accepted('receipt-1'),
    pullChanges: async () => ({ status: 200, body: { events: [], next_cursor: '0' }, retryAfterSeconds: null }),
    refreshSession: async () => false,
    refreshCareOrders: async () => {
      careCalls += 1
      throw new Error('care_orders_down')
    },
  })
  assert.equal(careCalls, 1)
  assert.equal((await database.outbox.get('op-1'))?.state, 'accepted')
  assert.equal((await database.receipts.get('op-1'))?.server_receipt_id, 'receipt-1')
  await database.delete()
})

async function seeded(): Promise<ArtemiaDb> {
  const database = new ArtemiaDb(`artemia-journal-${crypto.randomUUID()}`)
  await database.open()
  return database
}

function item(operationId: string, state: OutboxItem['state'], patch: Partial<OutboxItem> = {}): OutboxItem {
  return {
    operation_id: operationId,
    owner_id: OWNER,
    environment_id: ENV,
    entity_type: 'checkin_bundle',
    entity_id: 'entity-1',
    payload_version: 1,
    frozen_payload: { comment: 'Самочувствие', personal: null },
    payload_hash: HASH,
    dependencies: [],
    state,
    attempts: 0,
    next_attempt_at: NOW,
    last_error_code: null,
    lease_until: null,
    created_at: NOW,
    ...patch,
  }
}

function checkin(id: string): LocalCheckin {
  return {
    id,
    owner_id: OWNER,
    environment_id: ENV,
    mission_id: '11111111-1111-4111-8111-111111111111',
    local_date: '2026-11-14',
    timezone: 'UTC',
    type: 'daily',
    root_id: id,
    device_id: 'web.test',
    recorded_at: NOW,
    created_at_device: NOW,
    source: 'manual',
    demo_dataset_id: null,
    delivery: 'queued',
    invalidated: false,
  }
}

function accepted(receiptId: string): OperationResponse {
  return { status: 200, body: { status: 'accepted', receipt_id: receiptId, payload_hash: HASH, error_code: null }, retryAfterSeconds: null }
}

async function deliver(
  database: ArtemiaDb,
  postOperation: (body: unknown, token: string) => Promise<OperationResponse>,
  manual: boolean,
  extra: { pullChanges?: (cursor: string, token: string) => Promise<OperationResponse> } = {},
): Promise<void> {
  await runDelivery({
    database,
    scope: { ownerId: OWNER, environmentId: ENV },
    sessionUserId: OWNER,
    token: 'token',
    manual,
    now: () => NOW,
    random: () => 0.5,
    postOperation,
    pullChanges: extra.pullChanges ?? (async () => ({ status: 200, body: { events: [], next_cursor: '0' }, retryAfterSeconds: null })),
    refreshSession: async () => false,
    refreshCareOrders: async () => undefined,
  })
}
