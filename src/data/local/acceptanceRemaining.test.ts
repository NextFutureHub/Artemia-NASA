import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGeneralPayload, emptyCheckinDraft } from '../../domain/checkinDraft.ts'
import { ArtemiaDb } from './db.ts'
import {
  clearOwner,
  commitCheckin,
  countPending,
  listCheckins,
  readDraft,
  readPreparedProfile,
  saveDraft,
} from './journal.ts'
import type { DraftRecord, MissionCache, OutboxItem, PreparedProfile } from './types.ts'

const OWNER = '22222222-2222-4222-8222-222222222222'
const MISSION = '11111111-1111-4111-8111-111111111111'
const ENV = 'demo'

test('A02 failed preparation leaves no ready local profile', async () => {
  const database = new ArtemiaDb(`artemia-a02-${crypto.randomUUID()}`)
  assert.equal(await database.preparedProfiles.count(), 0)
  assert.equal(await readPreparedProfile(database, ENV), null)
  database.close()
  await database.delete()
})

test('A03 prepared profile and mission survive reopen without the network', async () => {
  const name = `artemia-a03-${crypto.randomUUID()}`
  const database = new ArtemiaDb(name)
  await seedProfile(database)
  database.close()

  const reopened = new ArtemiaDb(name)
  const profile = await readPreparedProfile(reopened, ENV)
  assert.equal(profile?.callsign, 'Mira-01')
  assert.equal(profile?.owner_id, OWNER)
  const mission = await reopened.missionCache.get([OWNER, ENV, MISSION])
  assert.equal(mission?.code, 'ORBIT-DEMO-01')
  reopened.close()
  await reopened.delete()
})

test('A06 two simultaneous saves keep one logical checkin', async () => {
  const database = new ArtemiaDb(`artemia-a06-${crypto.randomUUID()}`)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await seedProfile(database)
  const draft = draftRecord()
  const general = buildGeneralPayload(draft.values, 'UTC', new Date('2026-11-14T12:00:00.000Z')).payload
  assert.ok(general)
  await saveDraft(database, draft)
  const clock = { recordedAt: '2026-11-14T11:00:00.000Z', localDate: '2026-11-14' }
  const [first, second] = await Promise.all([
    commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, true, clock),
    commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, true, clock),
  ])
  assert.equal(first.status, 'committed')
  assert.equal(second.status, 'committed')
  assert.equal(await database.localCheckins.count(), 1)
  assert.equal(await database.localCheckinRevisions.count(), 1)
  assert.equal(await database.outbox.count(), 1)
  assert.equal((await listCheckins(database, scope)).length, 1)
  database.close()
  await database.delete()
})

test('A08 stepping back keeps the draft values', async () => {
  const database = new ArtemiaDb(`artemia-a08-${crypto.randomUUID()}`)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await seedProfile(database)
  const draft = draftRecord()
  draft.step = 'general'
  draft.values.overallState = 'good'
  draft.values.fatigue = 3
  draft.values.comment = 'Сохранено на шаге'
  await saveDraft(database, draft)

  const next: DraftRecord = {
    ...draft,
    step: 'symptoms',
    values: { ...draft.values, symptomPresence: 'no' },
    updated_at: '2026-11-14T11:01:00.000Z',
  }
  await saveDraft(database, next)

  const back: DraftRecord = {
    ...next,
    step: 'general',
    values: { ...next.values },
    updated_at: '2026-11-14T11:02:00.000Z',
  }
  await saveDraft(database, back)

  const loaded = await readDraft(database, scope, draft.id)
  assert.equal(loaded?.step, 'general')
  assert.equal(loaded?.values.overallState, 'good')
  assert.equal(loaded?.values.fatigue, 3)
  assert.equal(loaded?.values.comment, 'Сохранено на шаге')
  assert.equal(loaded?.values.symptomPresence, 'no')
  database.close()
  await database.delete()
})

test('A43 clearing is blocked while the outbox still has pending work', async () => {
  const database = new ArtemiaDb(`artemia-a43-${crypto.randomUUID()}`)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await seedProfile(database)
  const draft = draftRecord()
  const general = buildGeneralPayload(draft.values, 'UTC', new Date('2026-11-14T12:00:00.000Z')).payload
  assert.ok(general)
  await saveDraft(database, draft)
  assert.equal(
    (
      await commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, true, {
        recordedAt: '2026-11-14T11:00:00.000Z',
        localDate: '2026-11-14',
      })
    ).status,
    'committed',
  )
  assert.equal(await countPending(database, scope), 1)

  const blocked = await clearOwner(database, scope)
  assert.deepEqual(blocked, { ok: false, pending: 1 })
  assert.equal(await database.preparedProfiles.count(), 1)
  assert.equal(await database.localCheckins.count(), 1)
  assert.equal(await database.outbox.count(), 1)

  const item = (await database.outbox.toArray())[0] as OutboxItem
  await database.outbox.put({ ...item, state: 'accepted' })
  assert.equal(await countPending(database, scope), 0)
  const cleared = await clearOwner(database, scope)
  assert.deepEqual(cleared, { ok: true })
  assert.equal(await database.preparedProfiles.count(), 0)
  assert.equal(await database.localCheckins.count(), 0)
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
    age: null,
    sex_context: null,
    device_id: 'web.device-1',
    demo_dataset_id: null,
    prepared_at: '2026-11-14T08:00:00.000Z',
    schema_version: 1,
    storage_persisted: true,
  }
  const mission: MissionCache = {
    owner_id: OWNER,
    environment_id: ENV,
    mission_id: MISSION,
    code: 'ORBIT-DEMO-01',
    name: 'Orbit demo',
    start_at: '2026-01-01T00:00:00.000Z',
    end_at: '2026-07-01T00:00:00.000Z',
    mode: 'extended',
    default_timezone: 'UTC',
    emergency_contact_text: 'Порядок обращения',
    ruleset_version: '1',
    demo_dataset_id: null,
  }
  await database.preparedProfiles.put(profile)
  await database.missionCache.put(mission)
}

function draftRecord(): DraftRecord {
  const checkinId = crypto.randomUUID()
  const values = emptyCheckinDraft('daily', '2026-11-14T11:00')
  values.overallState = 'fair'
  values.sleepHours = '7.5'
  values.sleepQualitySkip = true
  values.fatigue = 0
  values.stressSkip = true
  values.emotional = 'calm'
  values.symptomPresence = 'no'
  values.reviewRequested = false
  values.comment = 'Самочувствие'
  return {
    id: crypto.randomUUID(),
    owner_id: OWNER,
    environment_id: ENV,
    kind: 'checkin',
    status: 'active',
    step: 'review',
    intent: 'create',
    checkin_id: checkinId,
    revision_id: crypto.randomUUID(),
    parent_revision_id: null,
    revision_no: 1,
    root_id: checkinId,
    reason: '',
    operation_id: crypto.randomUUID(),
    values,
    updated_at: '2026-11-14T11:00:00.000Z',
  }
}
