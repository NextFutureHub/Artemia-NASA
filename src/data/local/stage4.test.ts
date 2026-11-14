import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGeneralPayload, emptyCheckinDraft } from '../../domain/checkinDraft.ts'
import { buildPersonalPayload, emptyPersonalFields } from '../../domain/personalDraft.ts'
import { buildReportSnapshot, mergeReportStatus } from '../../domain/reportSnapshot.ts'
import { ArtemiaDb } from './db.ts'
import {
  applyOutboxResult,
  commitCheckin,
  commitReport,
  listReports,
  queueConsentDecision,
  readPersonalRevision,
  readReport,
  saveDraft,
} from './journal.ts'
import type { DraftRecord, MissionCache, PreparedProfile } from './types.ts'

const OWNER = '22222222-2222-4222-8222-222222222222'
const MISSION = '11111111-1111-4111-8111-111111111111'
const ASSIGNMENT = '10000000-0000-4000-8000-000000000021'
const ENV = 'demo'

test('a device-only personal section stays out of the outbox while the general part can be queued', async () => {
  const database = await seeded()
  const scope = { ownerId: OWNER, environmentId: ENV }
  const draft = draftRecord()
  const values = emptyCheckinDraft('daily', '2026-11-14T11:00')
  Object.assign(values, filledGeneral(), emptyPersonalFields('device_only'), { personalFill: 'yes' as const, bleeding: 'menstrual' as const })
  draft.values = values
  const general = buildGeneralPayload(values, 'UTC', new Date('2026-11-14T12:00:00.000Z')).payload
  const personal = buildPersonalPayload(values, true).payload
  assert.ok(general)
  assert.ok(personal)
  await saveDraft(database, draft)
  const saved = await commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, true, clock(), {
    payload: personal,
    sharing: 'device_only',
    personalId: crypto.randomUUID(),
    consentId: crypto.randomUUID(),
    consentOperationId: crypto.randomUUID(),
    assignmentId: ASSIGNMENT,
  })
  assert.equal(saved.status, 'committed')
  if (saved.status !== 'committed') return
  assert.equal(saved.personalDelivery, 'local_only')
  const queued = await database.outbox.toArray()
  assert.equal(queued.length, 1)
  assert.equal(queued[0]?.entity_type, 'checkin_bundle')
  const frozen = JSON.stringify(queued[0]?.frozen_payload)
  assert.equal(frozen.includes('bleeding_category'), false)
  assert.equal(frozen.includes('"personal":null'), true)
  const revision = await readPersonalRevision(database, scope, draft.revision_id)
  assert.equal(revision?.included_in_outbox, false)
  assert.equal(revision?.sharing, 'device_only')
  assert.notEqual(revision?.payload_hash, (await database.localCheckinRevisions.toArray())[0]?.payload_hash)
  database.close()
  await database.delete()
})

test('the general share checkbox does not put a local personal section on the network', async () => {
  const database = await seeded()
  const scope = { ownerId: OWNER, environmentId: ENV }
  const draft = draftRecord()
  const values = emptyCheckinDraft('daily', '2026-11-14T11:00', 'device_only')
  Object.assign(values, filledGeneral(), { personalFill: 'yes' as const })
  draft.values = values
  const general = buildGeneralPayload(values, 'UTC', new Date('2026-11-14T12:00:00.000Z')).payload
  const personal = buildPersonalPayload(values, true).payload
  assert.ok(general && personal)
  await saveDraft(database, draft)
  await commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, true, clock(), {
    payload: personal,
    sharing: values.personalSharing ?? 'device_only',
    personalId: crypto.randomUUID(),
    consentId: crypto.randomUUID(),
    consentOperationId: crypto.randomUUID(),
    assignmentId: ASSIGNMENT,
  })
  const types = (await database.outbox.toArray()).map((row) => row.entity_type)
  assert.deepEqual(types, ['checkin_bundle'])
  database.close()
  await database.delete()
})

test('an explicit physician share queues consent separately from the general record', async () => {
  const database = await seeded()
  const scope = { ownerId: OWNER, environmentId: ENV }
  const draft = draftRecord()
  const values = emptyCheckinDraft('daily', '2026-11-14T11:00', 'assigned_doctor')
  Object.assign(values, filledGeneral(), { personalFill: 'yes' as const, personalSharing: 'assigned_doctor' as const })
  draft.values = values
  const general = buildGeneralPayload(values, 'UTC', new Date('2026-11-14T12:00:00.000Z')).payload
  const personal = buildPersonalPayload(values, true).payload
  assert.ok(general && personal)
  await saveDraft(database, draft)
  const consentOperationId = crypto.randomUUID()
  const saved = await commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, true, clock(), {
    payload: personal,
    sharing: 'assigned_doctor',
    personalId: crypto.randomUUID(),
    consentId: crypto.randomUUID(),
    consentOperationId,
    assignmentId: ASSIGNMENT,
  })
  assert.equal(saved.status, 'committed')
  if (saved.status !== 'committed') return
  assert.equal(saved.personalDelivery, 'queued')
  const rows = await database.outbox.toArray()
  const consent = rows.find((row) => row.entity_type === 'consent_change')
  const checkin = rows.find((row) => row.entity_type === 'checkin_bundle')
  assert.ok(consent)
  assert.equal(JSON.stringify(consent.frozen_payload).includes('bleeding_category'), false)
  assert.ok(checkin)
  assert.deepEqual(checkin.dependencies, [consentOperationId])
  assert.equal(JSON.stringify(checkin.frozen_payload).includes('bleeding_category'), true)
  database.close()
  await database.delete()
})

test('preview snapshot is the stored report and acceptance does not open it', async () => {
  const database = await seeded()
  const scope = { ownerId: OWNER, environmentId: ENV }
  const draft = draftRecord()
  const general = buildGeneralPayload(filledGeneral(), 'UTC', new Date('2026-11-14T12:00:00.000Z')).payload
  assert.ok(general)
  draft.values = filledGeneral()
  await saveDraft(database, draft)
  await commitCheckin(database, scope, draft.id, draft.operation_id ?? '', general, true, clock())
  const preview = buildReportSnapshot({
    revisionIds: [draft.revision_id],
    measurements: [],
    reviewRequested: false,
    preparedAt: '2026-11-14T12:00:00.000Z',
    message: null,
    recipientAssignmentId: ASSIGNMENT,
    locale: 'ru',
  }).snapshot
  assert.ok(preview)
  const reportId = crypto.randomUUID()
  const operationId = crypto.randomUUID()
  const saved = await commitReport(database, scope, {
    reportId,
    operationId,
    title: 'Самочувствие · 2026-11-14',
    rangeStart: '2026-11-14',
    rangeEnd: '2026-11-14',
    reason: 'planned',
    message: null,
    parentReportId: null,
    recipientAssignmentId: ASSIGNMENT,
    recipientLabel: 'Flight-Doc',
    snapshot: preview,
    send: true,
    checkinIds: [draft.checkin_id],
    personal: null,
    dependencies: [],
  })
  assert.equal(saved.status, 'committed')
  const stored = await readReport(database, scope, reportId)
  assert.deepEqual(stored?.general_snapshot, preview)
  assert.equal(stored?.doctor_work, 'not_opened')
  assert.equal(stored?.delivery, 'queued')
  const claimed = await database.outbox.get(operationId)
  assert.ok(claimed)
  claimed.state = 'sending'
  claimed.lease_until = '2026-11-14T12:01:00.000Z'
  await database.outbox.put(claimed)
  await applyOutboxResult(database, scope, claimed, {
    state: 'accepted',
    attempts: 1,
    nextAttemptAt: '2026-11-14T12:01:00.000Z',
    errorCode: null,
    serverReceiptId: crypto.randomUUID(),
  })
  const accepted = await readReport(database, scope, reportId)
  const merged = mergeReportStatus('accepted', [{ event_type: 'accepted', server_at: '2026-11-14T12:01:00.000Z' }])
  assert.equal(accepted?.delivery, 'accepted')
  assert.equal(accepted?.doctor_work, merged.doctorWork)
  assert.equal(accepted?.doctor_work, 'not_opened')
  assert.deepEqual(accepted?.general_snapshot, preview)

  const correction = draftRecord()
  correction.checkin_id = draft.checkin_id
  correction.root_id = draft.root_id
  correction.revision_no = 2
  correction.parent_revision_id = draft.revision_id
  correction.intent = 'revise'
  correction.reason = 'уточнение'
  correction.values = filledGeneral()
  correction.values.comment = 'Новее'
  await saveDraft(database, correction)
  const newer = buildGeneralPayload(correction.values, 'UTC', new Date('2026-11-14T12:00:00.000Z')).payload
  assert.ok(newer)
  await commitCheckin(database, scope, correction.id, correction.operation_id ?? '', newer, true, clock())
  const untouched = await readReport(database, scope, reportId)
  assert.deepEqual(untouched?.general_snapshot.revision_ids, [draft.revision_id])
  assert.equal((await listReports(database, scope)).length, 1)
  database.close()
  await database.delete()
})

test('an offline revoke waits for the server', async () => {
  const database = await seeded()
  const scope = { ownerId: OWNER, environmentId: ENV }
  const consentId = crypto.randomUUID()
  const operationId = crypto.randomUUID()
  const queued = await queueConsentDecision(database, scope, {
    consentId,
    operationId,
    missionId: MISSION,
    consentScope: 'personal_sharing',
    decision: 'revoked',
    assignmentId: ASSIGNMENT,
    supersedesId: null,
    recordedAt: '2026-11-14T12:00:00.000Z',
  })
  assert.equal(queued.applyState, 'waiting_for_server')
  const row = await database.consentCache.get(consentId)
  assert.equal(row?.applied_on_server, false)
  assert.equal(JSON.stringify((await database.outbox.get(operationId))?.frozen_payload).includes('bleeding'), false)
  const claimed = await database.outbox.get(operationId)
  assert.ok(claimed)
  claimed.state = 'sending'
  claimed.lease_until = '2026-11-14T12:02:00.000Z'
  await database.outbox.put(claimed)
  await applyOutboxResult(database, scope, claimed, {
    state: 'accepted',
    attempts: 1,
    nextAttemptAt: '2026-11-14T12:02:00.000Z',
    errorCode: null,
    serverReceiptId: crypto.randomUUID(),
  })
  assert.equal((await database.consentCache.get(consentId))?.applied_on_server, true)
  database.close()
  await database.delete()
})

async function seeded(): Promise<ArtemiaDb> {
  const database = new ArtemiaDb(`artemia-journal-${crypto.randomUUID()}`)
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
    reproductive_enabled: true,
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
  return database
}

function filledGeneral() {
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
  return values
}

function draftRecord(): DraftRecord {
  const checkinId = crypto.randomUUID()
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
    values: filledGeneral(),
    updated_at: '2026-11-14T11:00:00.000Z',
  }
}

function clock() {
  return { recordedAt: '2026-11-14T11:00:00.000Z', localDate: '2026-11-14' }
}
