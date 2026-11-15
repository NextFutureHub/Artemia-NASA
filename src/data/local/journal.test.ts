import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGeneralPayload, emptyCheckinDraft } from '../../domain/checkinDraft.ts'
import { ArtemiaDb } from './db.ts'
import { commitCheckin, ensureActiveCheckinDraft, listCheckins, readCheckin, readRevisions, saveDraft } from './journal.ts'
import type { DraftRecord, MissionCache, PreparedProfile } from './types.ts'

const OWNER = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const MISSION = '11111111-1111-4111-8111-111111111111'
const ENV = 'demo'

test('a committed checkin survives a new database connection and stays with its owner', async () => {
  const name = `artemia-journal-${crypto.randomUUID()}`
  const database = new ArtemiaDb(name)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await seedProfile(database)
  const draft = draftRecord()
  const general = buildGeneralPayload(draft.values, 'UTC', new Date('2026-11-14T12:00:00.000Z')).payload
  assert.ok(general)
  await saveDraft(database, draft)
  const saved = await commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, false, {
    recordedAt: '2026-11-14T11:00:00.000Z',
    localDate: '2026-11-14',
  })
  assert.equal(saved.status, 'committed')
  if (saved.status !== 'committed') return
  assert.equal(saved.delivery, 'local_only')
  const again = await commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, false, {
    recordedAt: '2026-11-14T11:00:00.000Z',
    localDate: '2026-11-14',
  })
  assert.equal(again.status, 'committed')
  assert.equal(await database.localCheckins.count(), 1)
  assert.equal(await database.outbox.count(), 0)

  database.close()
  const reopened = new ArtemiaDb(name)
  const row = await readCheckin(reopened, scope, draft.checkin_id)
  assert.equal(row?.id, draft.checkin_id)
  const revisions = await readRevisions(reopened, scope, draft.checkin_id)
  assert.equal(revisions[0]?.general_payload.fatigue_score, 0)
  assert.equal(revisions[0]?.general_payload.stress_score, null)
  assert.equal(await readCheckin(reopened, { ownerId: OTHER, environmentId: ENV }, draft.checkin_id), null)
  assert.equal((await listCheckins(reopened, { ownerId: OTHER, environmentId: ENV })).length, 0)
  reopened.close()
  await reopened.delete()
})

test('the same operation id with a different payload does not overwrite the record', async () => {
  const database = new ArtemiaDb(`artemia-journal-${crypto.randomUUID()}`)
  const scope = { ownerId: OWNER, environmentId: ENV }
  await seedProfile(database)
  const draft = draftRecord()
  const now = new Date('2026-11-14T12:00:00.000Z')
  const general = buildGeneralPayload(draft.values, 'UTC', now).payload
  assert.ok(general)
  await saveDraft(database, draft)
  const clock = { recordedAt: '2026-11-14T11:00:00.000Z', localDate: '2026-11-14' }
  assert.equal((await commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, true, clock)).status, 'committed')
  await database.drafts.update(draft.id, { status: 'active' })
  const changed = { ...general, comment: 'Другой текст' }
  const conflict = await commitCheckin(database, scope, draft.id, draft.operation_id ?? '', changed, true, clock)
  assert.equal(conflict.status, 'conflict')
  const revisions = await readRevisions(database, scope, draft.checkin_id)
  assert.equal(revisions.length, 1)
  assert.equal(revisions[0]?.general_payload.comment, 'Самочувствие')
  assert.equal(await database.outbox.count(), 1)
  database.close()
  await database.delete()
})

test('two overlapping creates keep a single active draft', async () => {
  const database = new ArtemiaDb(`artemia-journal-${crypto.randomUUID()}`)
  const first = draftRecord()
  const second = draftRecord()
  second.updated_at = '2026-11-14T11:00:01.000Z'
  const [keptFirst, keptSecond] = await Promise.all([
    ensureActiveCheckinDraft(database, first),
    ensureActiveCheckinDraft(database, second),
  ])
  assert.equal(keptFirst.id, keptSecond.id)
  assert.equal(await database.drafts.count(), 1)
  database.close()
  await database.delete()
})

test('a closed database does not report the record as saved', async () => {
  const database = new ArtemiaDb(`artemia-journal-${crypto.randomUUID()}`)
  await seedProfile(database)
  const draft = draftRecord()
  const general = buildGeneralPayload(draft.values, 'UTC', new Date('2026-11-14T12:00:00.000Z')).payload
  assert.ok(general)
  await saveDraft(database, draft)
  database.close()
  await assert.rejects(() =>
    commitCheckin(database, { ownerId: OWNER, environmentId: ENV }, draft.id, draft.operation_id ?? '', general, false, {
      recordedAt: '2026-11-14T11:00:00.000Z',
      localDate: '2026-11-14',
    }),
  )
  const opened = new ArtemiaDb(database.name)
  assert.equal((await listCheckins(opened, { ownerId: OWNER, environmentId: ENV })).length, 0)
  opened.close()
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
  values.nutritionFill = 'skipped'
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
