import { hashOperation, hashPayloadPart } from '../../domain/canonicalJson.ts'
import {
  checkinBundleSchema,
  consentChangeSchema,
  measurementOperationSchema,
  profilePreferencesSchema,
  reportAckSchema,
  reportBundleSchema,
} from '../../domain/operation.ts'
import { SCHEMA_VERSION } from '../../domain/schemaVersion.ts'
import type { GeneralPayload } from '../../domain/generalPayload.ts'
import type { PersonalPayload } from '../../domain/personalPayload.ts'
import type { ReportSnapshot } from '../../domain/reportSnapshot.ts'
import { mergeReportStatus } from '../../domain/reportSnapshot.ts'
import { OPERATION_TYPES, type ConsentDecision, type ConsentScope, type OperationType, type ReportReason, type SharingMode } from '../../domain/enums.ts'
import type { ArtemiaDb } from './db.ts'
import type {
  AssignmentCache,
  DraftRecord,
  LocalAudit,
  LocalCheckin,
  LocalConsent,
  LocalDelivery,
  LocalMeasurement,
  LocalMessage,
  LocalPersonalReport,
  LocalPersonalRevision,
  LocalReceipt,
  LocalReport,
  LocalRevision,
  MissionCache,
  OutboxItem,
  PreparedProfile,
  RuleCache,
  Scope,
  SourceCache,
} from './types.ts'

const ALLOWED_OUTBOX = new Set<string>(OPERATION_TYPES)

export type CommitStatus =
  | {
      status: 'committed'
      entityId: string
      delivery: LocalDelivery
      savedAt: string
      personalDelivery?: 'omitted' | 'local_only' | 'queued'
    }
  | { status: 'conflict' }
  | { status: 'rejected'; reason: string }

export type PersonalCommit = {
  payload: PersonalPayload
  sharing: SharingMode
  personalId: string
  consentId: string
  consentOperationId: string
  assignmentId: string | null
}

export async function readPreparedProfile(database: ArtemiaDb, environmentId: string): Promise<PreparedProfile | null> {
  const rows = await database.preparedProfiles.where('environment_id').equals(environmentId).toArray()
  if (rows.length !== 1) return null
  return rows[0]
}

export async function countPreparedProfiles(database: ArtemiaDb, environmentId: string): Promise<number> {
  return database.preparedProfiles.where('environment_id').equals(environmentId).count()
}

export async function saveDraft(database: ArtemiaDb, draft: DraftRecord): Promise<string> {
  const updatedAt = new Date().toISOString()
  await database.transaction('rw', database.drafts, async () => {
    const current = await database.drafts.get(draft.id)
    if (current && !sameOwner(current, { ownerId: draft.owner_id, environmentId: draft.environment_id })) throw new Error('draft_owner_mismatch')
    await database.drafts.put({ ...draft, updated_at: updatedAt })
  })
  return updatedAt
}

export async function readDraft(database: ArtemiaDb, scope: Scope, draftId: string): Promise<DraftRecord | null> {
  const row = await database.drafts.get(draftId)
  if (!row || !sameOwner(row, scope)) return null
  return row
}

export async function readActiveDraft(database: ArtemiaDb, scope: Scope): Promise<DraftRecord | null> {
  const rows = await activeCheckinDrafts(database, scope.ownerId, scope.environmentId)
  return rows[0] ?? null
}

export async function ensureActiveCheckinDraft(database: ArtemiaDb, candidate: DraftRecord): Promise<DraftRecord> {
  return database.transaction('rw', database.drafts, async () => {
    if (candidate.intent === 'create') {
      const active = await activeCheckinDrafts(database, candidate.owner_id, candidate.environment_id)
      if (active[0]) return active[0]
    }
    await database.drafts.put(candidate)
    return candidate
  })
}

async function activeCheckinDrafts(database: ArtemiaDb, ownerId: string, environmentId: string): Promise<DraftRecord[]> {
  const rows = await database.drafts.where('[owner_id+environment_id]').equals([ownerId, environmentId]).toArray()
  return rows
    .filter((row) => row.status === 'active' && row.kind === 'checkin')
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

export async function deleteDraft(database: ArtemiaDb, scope: Scope, draftId: string): Promise<void> {
  const row = await readDraft(database, scope, draftId)
  if (row) await database.drafts.delete(draftId)
}

export async function commitCheckin(
  database: ArtemiaDb,
  scope: Scope,
  draftId: string,
  operationId: string,
  general: GeneralPayload,
  shareGeneral: boolean,
  clock: { recordedAt: string; localDate: string },
  personal: PersonalCommit | null = null,
): Promise<CommitStatus> {
  const savedAt = new Date().toISOString()
  const draft = await database.drafts.get(draftId)
  if (!draft || !sameOwner(draft, scope)) return { status: 'rejected', reason: 'draft_missing' }
  if (draft.intent === 'revise' && draft.reason.trim().length === 0) {
    return { status: 'rejected', reason: 'reason_required' }
  }
  const existing = await database.receipts.get(operationId)
  if (existing && !sameOwner(existing, scope)) return { status: 'conflict' }
  const checkin = await ownedCheckin(database, scope, draft.checkin_id)
  if (!checkin && draft.revision_no !== 1) return { status: 'rejected', reason: 'checkin_missing' }
  const measurementIds = draft.values.measurementIds
  const measurements: LocalMeasurement[] = []
  for (const measurementId of measurementIds) {
    const measurement = await ownedMeasurement(database, scope, measurementId)
    if (!measurement) return { status: 'rejected', reason: 'measurement_not_owned' }
    measurements.push(measurement)
  }
  const profile = await database.preparedProfiles.get([scope.ownerId, scope.environmentId])
  if (!profile) return { status: 'rejected', reason: 'profile_missing' }
  const bundle = {
    checkin: {
      id: draft.checkin_id,
      mission_id: profile.mission_id,
      local_date: checkin?.local_date ?? clock.localDate,
      timezone: profile.timezone,
      type: draft.values.type,
      root_id: draft.root_id,
      device_id: profile.device_id,
      recorded_at: checkin?.recorded_at ?? clock.recordedAt,
      created_at_device: checkin?.created_at_device ?? savedAt,
      source: 'manual' as const,
      demo_dataset_id: profile.demo_dataset_id,
    },
    revision: {
      id: draft.revision_id,
      parent_revision_id: draft.parent_revision_id,
      revision_no: draft.revision_no,
      general_payload: general,
      reason: draft.revision_no === 1 ? null : draft.reason.trim(),
    },
    personal: null as { id: string; personal_payload: PersonalPayload; consent_event_id: string } | null,
    measurement_ids: measurementIds,
  }
  const sendPersonal = personal !== null && personal.sharing === 'assigned_doctor' && shareGeneral && personal.assignmentId !== null
  if (sendPersonal && personal) {
    bundle.personal = {
      id: personal.personalId,
      personal_payload: personal.payload,
      consent_event_id: personal.consentId,
    }
  }
  const personalHash = personal ? await hashPayloadPart(personal.payload) : null
  const parsed = checkinBundleSchema.safeParse(bundle)
  if (!parsed.success) return { status: 'rejected', reason: 'invalid_bundle' }
  const payloadHash = await hashOperation({
    schemaVersion: SCHEMA_VERSION,
    type: 'checkin_bundle',
    payload: parsed.data,
  })
  if (existing) {
    if (existing.payload_hash !== payloadHash) return { status: 'conflict' }
    return {
      status: 'committed',
      entityId: existing.entity_id,
      delivery: checkin?.delivery ?? 'local_only',
      savedAt: existing.local_committed_at,
    }
  }
  if (draft.status !== 'active') return { status: 'rejected', reason: 'draft_missing' }
  const partHash = await hashPayloadPart(parsed.data.revision.general_payload)
  const delivery: LocalDelivery = shareGeneral ? 'queued' : 'local_only'
  const personalDelivery: 'omitted' | 'local_only' | 'queued' = personal === null ? 'omitted' : sendPersonal ? 'queued' : 'local_only'
  const consentPayload = sendPersonal && personal
    ? consentChangeSchema.parse({
        id: personal.consentId,
        mission_id: profile.mission_id,
        scope: 'personal_sharing',
        decision: 'granted',
        assignment_id: personal.assignmentId,
        supersedes_id: null,
        recorded_at: clock.recordedAt,
        created_at_device: savedAt,
      })
    : null
  const consentHash = consentPayload
    ? await hashOperation({ schemaVersion: SCHEMA_VERSION, type: 'consent_change', payload: consentPayload })
    : null
  try {
    return await database.transaction(
      'rw',
      [
        database.drafts,
        database.localCheckins,
        database.localCheckinRevisions,
        database.localPersonalRevisions,
        database.localMeasurements,
        database.localCheckinMeasurements,
        database.consentCache,
        database.outbox,
        database.receipts,
        database.localAudit,
      ],
      async () => {
        if (draft.revision_no === 1) {
          const row: LocalCheckin = {
            id: draft.checkin_id,
            owner_id: scope.ownerId,
            environment_id: scope.environmentId,
            mission_id: profile.mission_id,
            local_date: parsed.data.checkin.local_date,
            timezone: profile.timezone,
            type: parsed.data.checkin.type,
            root_id: draft.root_id,
            device_id: profile.device_id,
            recorded_at: parsed.data.checkin.recorded_at,
            created_at_device: parsed.data.checkin.created_at_device,
            source: 'manual',
            demo_dataset_id: profile.demo_dataset_id,
            delivery,
            invalidated: false,
          }
          await database.localCheckins.put(row)
        } else if (checkin) {
          await database.localCheckins.put({ ...checkin, delivery })
        }
        const revision: LocalRevision = {
          id: draft.revision_id,
          owner_id: scope.ownerId,
          environment_id: scope.environmentId,
          checkin_id: draft.checkin_id,
          parent_revision_id: draft.parent_revision_id,
          revision_no: draft.revision_no,
          general_payload: parsed.data.revision.general_payload,
          reason: parsed.data.revision.reason,
          schema_version: 1,
          payload_hash: partHash,
          created_at_device: savedAt,
        }
        await database.localCheckinRevisions.put(revision)
        if (personal && personalHash) {
          const personalRow: LocalPersonalRevision = {
            id: personal.personalId,
            owner_id: scope.ownerId,
            environment_id: scope.environmentId,
            checkin_id: draft.checkin_id,
            general_revision_id: draft.revision_id,
            personal_payload: personal.payload,
            payload_hash: personalHash,
            sharing: personal.sharing,
            consent_event_id: sendPersonal ? personal.consentId : null,
            included_in_outbox: sendPersonal,
            schema_version: 1,
          }
          await database.localPersonalRevisions.put(personalRow)
        }
        for (const measurementId of measurementIds) {
          await database.localCheckinMeasurements.put({
            owner_id: scope.ownerId,
            environment_id: scope.environmentId,
            revision_id: draft.revision_id,
            measurement_id: measurementId,
          })
        }
        const dependencies: string[] = []
        if (sendPersonal && personal && consentPayload && consentHash) {
          const consent: LocalConsent = {
            id: personal.consentId,
            owner_id: scope.ownerId,
            environment_id: scope.environmentId,
            mission_id: profile.mission_id,
            scope: 'personal_sharing',
            decision: 'granted',
            assignment_id: personal.assignmentId,
            supersedes_id: null,
            recorded_at: clock.recordedAt,
            created_at_device: savedAt,
            applied_on_server: false,
            operation_id: personal.consentOperationId,
          }
          await database.consentCache.put(consent)
          await enqueue(database, {
            operation_id: personal.consentOperationId,
            owner_id: scope.ownerId,
            environment_id: scope.environmentId,
            entity_type: 'consent_change',
            entity_id: personal.consentId,
            payload_version: 1,
            frozen_payload: consentPayload,
            payload_hash: consentHash,
            dependencies: [],
            state: 'pending',
            attempts: 0,
            next_attempt_at: savedAt,
            last_error_code: null,
            lease_until: null,
            created_at: savedAt,
          })
          dependencies.push(personal.consentOperationId)
        }
        if (shareGeneral) {
          for (const measurement of measurements) {
            dependencies.push(measurement.operation_id)
            if (measurement.delivery === 'local_only') {
              await enqueueMeasurement(database, scope, measurement, savedAt)
              await database.localMeasurements.put({ ...measurement, delivery: 'queued' })
            }
          }
          await enqueue(database, {
            operation_id: operationId,
            owner_id: scope.ownerId,
            environment_id: scope.environmentId,
            entity_type: 'checkin_bundle',
            entity_id: draft.checkin_id,
            payload_version: 1,
            frozen_payload: parsed.data,
            payload_hash: payloadHash,
            dependencies,
            state: 'pending',
            attempts: 0,
            next_attempt_at: savedAt,
            last_error_code: null,
            lease_until: null,
            created_at: savedAt,
          })
        }
        await database.receipts.put({
          operation_id: operationId,
          owner_id: scope.ownerId,
          environment_id: scope.environmentId,
          entity_type: 'checkin_bundle',
          entity_id: draft.checkin_id,
          payload_hash: payloadHash,
          local_committed_at: savedAt,
          server_receipt_id: null,
        })
        await writeAudit(database, scope, 'checkin_saved', operationId, draft.checkin_id, savedAt)
        await database.drafts.put({ ...draft, status: 'completed', operation_id: operationId, updated_at: savedAt })
        return { status: 'committed', entityId: draft.checkin_id, delivery, savedAt, personalDelivery }
      },
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'outbox_type_rejected') {
      return { status: 'rejected', reason: 'outbox_type_rejected' }
    }
    throw error
  }
}

export async function commitMeasurement(
  database: ArtemiaDb,
  scope: Scope,
  measurement: LocalMeasurement,
  operationPayload: unknown,
  shareGeneral: boolean,
): Promise<CommitStatus> {
  const savedAt = new Date().toISOString()
  const parsed = measurementOperationSchema.safeParse(operationPayload)
  if (!parsed.success || parsed.data.source !== 'manual' || parsed.data.quality !== 'unknown') {
    return { status: 'rejected', reason: 'invalid_measurement' }
  }
  const payloadHash = await hashOperation({
    schemaVersion: SCHEMA_VERSION,
    type: 'measurement',
    payload: parsed.data,
  })
  return database.transaction('rw', [database.localMeasurements, database.outbox, database.receipts, database.localAudit], async () => {
    const existing = await database.receipts.get(measurement.operation_id)
    if (existing && !sameOwner(existing, scope)) return { status: 'conflict' }
    if (existing) {
      if (existing.payload_hash !== payloadHash) return { status: 'conflict' }
      return {
        status: 'committed',
        entityId: existing.entity_id,
        delivery: shareGeneral ? 'queued' : 'local_only',
        savedAt: existing.local_committed_at,
      }
    }
    const foreign = await database.localMeasurements.get(measurement.id)
    if (foreign && !sameOwner(foreign, scope)) return { status: 'rejected', reason: 'measurement_not_owned' }
    const delivery: LocalDelivery = shareGeneral ? 'queued' : 'local_only'
    const row = { ...measurement, delivery, payload_hash: payloadHash, schema_version: 1 as const }
    await database.localMeasurements.put(row)
    if (shareGeneral) await enqueueMeasurement(database, scope, row, savedAt)
    await database.receipts.put({
      operation_id: measurement.operation_id,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      entity_type: 'measurement',
      entity_id: measurement.id,
      payload_hash: payloadHash,
      local_committed_at: savedAt,
      server_receipt_id: null,
    })
    await writeAudit(database, scope, 'measurement_saved', measurement.operation_id, measurement.id, savedAt)
    return { status: 'committed', entityId: measurement.id, delivery, savedAt }
  })
}

export async function queueProfilePreferences(database: ArtemiaDb, scope: Scope, operationId: string): Promise<void> {
  const profile = await database.preparedProfiles.get([scope.ownerId, scope.environmentId])
  if (!profile || profile.owner_id !== scope.ownerId) return
  const payload = profilePreferencesSchema.parse({
    locale: profile.locale,
    timezone: profile.timezone,
    age: profile.age,
    sex_context: profile.sex_context,
    reproductive_enabled: profile.reproductive_enabled,
    cycle_context: null,
    default_sharing: profile.sensitive_sharing,
  })
  const savedAt = new Date().toISOString()
  const payloadHash = await hashOperation({ schemaVersion: SCHEMA_VERSION, type: 'profile_preferences', payload })
  await database.transaction('rw', [database.outbox, database.receipts, database.localAudit], async () => {
    const existing = await database.receipts.get(operationId)
    if (existing) return
    if (!profile.general_exchange) return
    await enqueue(database, {
      operation_id: operationId,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      entity_type: 'profile_preferences',
      entity_id: scope.ownerId,
      payload_version: 1,
      frozen_payload: payload,
      payload_hash: payloadHash,
      dependencies: [],
      state: 'pending',
      attempts: 0,
      next_attempt_at: savedAt,
      last_error_code: null,
      lease_until: null,
      created_at: savedAt,
    })
    await database.receipts.put({
      operation_id: operationId,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      entity_type: 'profile_preferences',
      entity_id: scope.ownerId,
      payload_hash: payloadHash,
      local_committed_at: savedAt,
      server_receipt_id: null,
    })
    await writeAudit(database, scope, 'preferences_queued', operationId, null, savedAt)
  })
}

export async function readCheckin(database: ArtemiaDb, scope: Scope, checkinId: string): Promise<LocalCheckin | null> {
  return ownedCheckin(database, scope, checkinId)
}

export async function readRevisions(database: ArtemiaDb, scope: Scope, checkinId: string): Promise<LocalRevision[]> {
  const rows = await database.localCheckinRevisions
    .where('[owner_id+environment_id+checkin_id]')
    .equals([scope.ownerId, scope.environmentId, checkinId])
    .toArray()
  return rows.sort((left, right) => left.revision_no - right.revision_no)
}

export async function listCheckins(database: ArtemiaDb, scope: Scope): Promise<LocalCheckin[]> {
  const rows = await database.localCheckins.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))
}

export async function listMeasurements(database: ArtemiaDb, scope: Scope): Promise<LocalMeasurement[]> {
  const rows = await database.localMeasurements.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))
}

export async function countPending(database: ArtemiaDb, scope: Scope): Promise<number> {
  const rows = await database.outbox.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.filter((row) => row.state !== 'accepted').length
}

export async function listOutbox(database: ArtemiaDb, scope: Scope): Promise<OutboxItem[]> {
  const rows = await database.outbox.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export async function requestRetry(database: ArtemiaDb, scope: Scope, operationId: string): Promise<void> {
  const row = await database.outbox.get(operationId)
  if (!row || !sameOwner(row, scope) || row.state === 'accepted' || row.state === 'sending') return
  await database.outbox.put({ ...row, state: 'pending', next_attempt_at: new Date().toISOString(), lease_until: null })
}

export async function listAudit(database: ArtemiaDb, scope: Scope): Promise<LocalAudit[]> {
  const rows = await database.localAudit.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))
}

export async function readMission(database: ArtemiaDb, scope: Scope, missionId: string): Promise<MissionCache | null> {
  const row = await database.missionCache.get([scope.ownerId, scope.environmentId, missionId])
  return row ?? null
}

export async function readAssignment(database: ArtemiaDb, scope: Scope): Promise<AssignmentCache | null> {
  return (await database.assignmentCache.get([scope.ownerId, scope.environmentId])) ?? null
}

export async function hideObservation(database: ArtemiaDb, scope: Scope, ruleId: string, entityId: string): Promise<void> {
  await database.observationHides.put({
    id: `${ruleId}:${entityId}`,
    owner_id: scope.ownerId,
    environment_id: scope.environmentId,
    rule_id: ruleId,
    entity_id: entityId,
  })
}

export async function hiddenObservationIds(database: ArtemiaDb, scope: Scope): Promise<Set<string>> {
  const rows = await database.observationHides.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return new Set(rows.map((row) => `${row.rule_id}:${row.entity_id}`))
}

export async function clearOwner(database: ArtemiaDb, scope: Scope): Promise<{ ok: true } | { ok: false; pending: number }> {
  const pending = await countPending(database, scope)
  if (pending > 0) return { ok: false, pending }
  await database.transaction('rw', database.tables, async () => {
    for (const table of database.tables) {
      await table.filter((row) => sameOwner(row as { owner_id: string; environment_id: string }, scope)).delete()
    }
  })
  return { ok: true }
}

export async function updateProfile(database: ArtemiaDb, profile: PreparedProfile): Promise<void> {
  const current = await database.preparedProfiles.get([profile.owner_id, profile.environment_id])
  if (current && current.owner_id !== profile.owner_id) return
  await database.preparedProfiles.put(profile)
}

export async function readReceiptForEntity(database: ArtemiaDb, scope: Scope, entityId: string): Promise<LocalReceipt | null> {
  const rows = await database.receipts.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.find((row) => row.entity_id === entityId) ?? null
}

const LEASE_MS = 30_000
const OPEN_STATES = new Set(['pending', 'retry_wait'])

export async function claimNextOutbox(
  database: ArtemiaDb,
  scope: Scope,
  nowIso: string,
  options: { manual: boolean; sessionMatches: boolean; skip: string[] },
): Promise<OutboxItem | null> {
  const now = Date.parse(nowIso)
  return database.transaction('rw', database.outbox, async () => {
    const rows = await database.outbox.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
    for (const row of rows) {
      if (row.state === 'sending' && row.lease_until !== null && Date.parse(row.lease_until) <= now) {
        await database.outbox.put({ ...row, state: 'pending', lease_until: null })
      }
      if (options.manual && options.sessionMatches && row.state === 'blocked_auth') {
        await database.outbox.put({ ...row, state: 'pending', last_error_code: null, next_attempt_at: nowIso })
      }
    }
    const fresh = await database.outbox.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
    const accepted = new Set(fresh.filter((row) => row.state === 'accepted').map((row) => row.operation_id))
    const ready = fresh
      .filter((row) => OPEN_STATES.has(row.state))
      .filter((row) => !options.skip.includes(row.operation_id))
      .filter((row) => options.manual || row.state !== 'retry_wait' || Date.parse(row.next_attempt_at) <= now)
      .filter((row) => options.manual || Date.parse(row.next_attempt_at) <= now)
      .filter((row) => row.dependencies.every((id) => accepted.has(id)))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
    const next = ready[0]
    if (!next) return null
    const claimed: OutboxItem = {
      ...next,
      state: 'sending',
      lease_until: new Date(now + LEASE_MS).toISOString(),
    }
    await database.outbox.put(claimed)
    return claimed
  })
}

export async function applyOutboxResult(
  database: ArtemiaDb,
  scope: Scope,
  claimed: OutboxItem,
  patch: {
    state: OutboxItem['state']
    attempts: number
    nextAttemptAt: string
    errorCode: string | null
    serverReceiptId: string | null
  },
): Promise<'applied' | 'stale'> {
  return database.transaction(
    'rw',
    [
      database.outbox,
      database.receipts,
      database.localCheckins,
      database.localMeasurements,
      database.localReports,
      database.localMessages,
      database.consentCache,
      database.localAudit,
    ],
    async () => {
    const current = await database.outbox.get(claimed.operation_id)
    if (!current || !sameOwner(current, scope) || current.lease_until !== claimed.lease_until) return 'stale'
    await database.outbox.put({
      ...current,
      state: patch.state,
      attempts: patch.attempts,
      next_attempt_at: patch.nextAttemptAt,
      last_error_code: patch.errorCode,
      lease_until: null,
    })
    if (patch.state !== 'accepted' || patch.serverReceiptId === null) return 'applied'
    const receipt = await database.receipts.get(claimed.operation_id)
    if (!receipt || !sameOwner(receipt, scope)) return 'applied'
    await database.receipts.put({ ...receipt, server_receipt_id: patch.serverReceiptId })
    if (claimed.entity_type === 'checkin_bundle') {
      const checkin = await database.localCheckins.get(claimed.entity_id)
      if (checkin && sameOwner(checkin, scope)) await database.localCheckins.put({ ...checkin, delivery: 'accepted' })
    }
    if (claimed.entity_type === 'measurement') {
      const measurement = await database.localMeasurements.get(claimed.entity_id)
      if (measurement && sameOwner(measurement, scope)) await database.localMeasurements.put({ ...measurement, delivery: 'accepted' })
    }
    if (claimed.entity_type === 'report_bundle') {
      const report = await database.localReports.get(claimed.entity_id)
      if (report && sameOwner(report, scope)) {
        const merged = mergeReportStatus('accepted', [])
        await database.localReports.put({
          ...report,
          delivery: 'accepted',
          doctor_work: report.doctor_work === 'not_opened' ? merged.doctorWork : report.doctor_work,
          accepted_at: patch.nextAttemptAt,
        })
      }
    }
    if (claimed.entity_type === 'consent_change') {
      const consent = await database.consentCache.get(claimed.entity_id)
      if (consent && sameOwner(consent, scope)) await database.consentCache.put({ ...consent, applied_on_server: true })
    }
    if (claimed.entity_type === 'report_ack') {
      const payload = claimed.frozen_payload as { ack_type?: string; message_id?: string | null }
      if (payload.ack_type === 'patient_read' && typeof payload.message_id === 'string') {
        const message = await database.localMessages.get(payload.message_id)
        if (message && sameOwner(message, scope)) {
          await database.localMessages.put({ ...message, read_server_at: patch.nextAttemptAt })
        }
      }
    }
    await writeAudit(database, scope, 'server_receipt', claimed.operation_id, claimed.entity_id, patch.nextAttemptAt)
    return 'applied'
  })
}

export async function readSyncCursor(database: ArtemiaDb, scope: Scope): Promise<string> {
  const row = await database.syncCursors.get(cursorId(scope))
  if (!row || !sameOwner(row, scope)) return '0'
  return row.scope
}

export async function commitSyncCursor(database: ArtemiaDb, scope: Scope, cursor: string, eventIds: string[], recordedAt: string): Promise<void> {
  await database.transaction('rw', [database.syncCursors, database.localAudit], async () => {
    await database.syncCursors.put({ id: cursorId(scope), owner_id: scope.ownerId, environment_id: scope.environmentId, scope: cursor })
    for (const eventId of eventIds) {
      await writeAudit(database, scope, 'pull_seen', null, eventId, recordedAt)
    }
  })
}

export async function readPersonalRevision(database: ArtemiaDb, scope: Scope, revisionId: string): Promise<LocalPersonalRevision | null> {
  const rows = await database.localPersonalRevisions.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.find((row) => row.general_revision_id === revisionId) ?? null
}

export async function listPersonalRevisions(database: ArtemiaDb, scope: Scope): Promise<LocalPersonalRevision[]> {
  const rows = await database.localPersonalRevisions.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.filter((row) => sameOwner(row, scope))
}

export async function latestConsent(database: ArtemiaDb, scope: Scope, consentScope: ConsentScope): Promise<LocalConsent | null> {
  const rows = await database.consentCache.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  const mine = rows.filter((row) => sameOwner(row, scope) && row.scope === consentScope)
  mine.sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))
  return mine[0] ?? null
}

export async function queueConsentDecision(
  database: ArtemiaDb,
  scope: Scope,
  input: {
    consentId: string
    operationId: string
    missionId: string
    consentScope: ConsentScope
    decision: ConsentDecision
    assignmentId: string | null
    supersedesId: string | null
    recordedAt: string
  },
): Promise<{ applyState: 'waiting_for_server' | 'applied' }> {
  const savedAt = new Date().toISOString()
  const payload = consentChangeSchema.parse({
    id: input.consentId,
    mission_id: input.missionId,
    scope: input.consentScope,
    decision: input.decision,
    assignment_id: input.assignmentId,
    supersedes_id: input.supersedesId,
    recorded_at: input.recordedAt,
    created_at_device: savedAt,
  })
  const payloadHash = await hashOperation({ schemaVersion: SCHEMA_VERSION, type: 'consent_change', payload })
  await database.transaction('rw', [database.consentCache, database.outbox, database.receipts, database.localAudit], async () => {
    const existing = await database.receipts.get(input.operationId)
    if (existing && sameOwner(existing, scope)) return
    const row: LocalConsent = {
      id: input.consentId,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      mission_id: input.missionId,
      scope: input.consentScope,
      decision: input.decision,
      assignment_id: input.assignmentId,
      supersedes_id: input.supersedesId,
      recorded_at: input.recordedAt,
      created_at_device: savedAt,
      applied_on_server: false,
      operation_id: input.operationId,
    }
    await database.consentCache.put(row)
    await enqueue(database, {
      operation_id: input.operationId,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      entity_type: 'consent_change',
      entity_id: input.consentId,
      payload_version: 1,
      frozen_payload: payload,
      payload_hash: payloadHash,
      dependencies: [],
      state: 'pending',
      attempts: 0,
      next_attempt_at: savedAt,
      last_error_code: null,
      lease_until: null,
      created_at: savedAt,
    })
    await database.receipts.put({
      operation_id: input.operationId,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      entity_type: 'consent_change',
      entity_id: input.consentId,
      payload_hash: payloadHash,
      local_committed_at: savedAt,
      server_receipt_id: null,
    })
    await writeAudit(database, scope, 'consent_queued', input.operationId, input.consentId, savedAt)
  })
  const stored = await database.consentCache.get(input.consentId)
  return { applyState: stored?.applied_on_server ? 'applied' : 'waiting_for_server' }
}

export async function commitReport(
  database: ArtemiaDb,
  scope: Scope,
  input: {
    reportId: string
    operationId: string
    title: string
    rangeStart: string
    rangeEnd: string
    reason: ReportReason
    message: string | null
    parentReportId: string | null
    recipientAssignmentId: string | null
    recipientLabel: string
    snapshot: ReportSnapshot
    send: boolean
    checkinIds: string[]
    personal: { payload: PersonalPayload; consentEventId: string } | null
    dependencies: string[]
  },
): Promise<CommitStatus> {
  const savedAt = new Date().toISOString()
  const profile = await database.preparedProfiles.get([scope.ownerId, scope.environmentId])
  if (!profile || profile.owner_id !== scope.ownerId) return { status: 'rejected', reason: 'profile_missing' }
  const generalHash = await hashPayloadPart(input.snapshot)
  const personalHash = input.personal ? await hashPayloadPart(input.personal.payload) : null
  const canSend = input.send && input.recipientAssignmentId !== null
  let frozen: unknown = null
  let payloadHash: string | null = null
  if (canSend && input.recipientAssignmentId) {
    const parsed = reportBundleSchema.safeParse({
      report: {
        id: input.reportId,
        mission_id: profile.mission_id,
        recipient_assignment_id: input.recipientAssignmentId,
        title: input.title,
        range_start: input.rangeStart,
        range_end: input.rangeEnd,
        reason: input.reason,
        general_snapshot: input.snapshot,
        message: input.message,
        parent_report_id: input.parentReportId,
        device_id: profile.device_id,
        recorded_at: savedAt,
        created_at_device: savedAt,
      },
      personal: input.personal
        ? { personal_snapshot: input.personal.payload, consent_event_id: input.personal.consentEventId }
        : null,
    })
    if (!parsed.success) return { status: 'rejected', reason: 'invalid_report' }
    frozen = parsed.data
    payloadHash = await hashOperation({ schemaVersion: SCHEMA_VERSION, type: 'report_bundle', payload: parsed.data })
  }
  const delivery: LocalReport['delivery'] = canSend ? 'queued' : 'local_only'
  return database.transaction(
    'rw',
    [database.localReports, database.localPersonalReports, database.outbox, database.receipts, database.localAudit],
    async () => {
      const existing = await database.receipts.get(input.operationId)
      if (existing && !sameOwner(existing, scope)) return { status: 'conflict' }
      if (existing) {
        if (payloadHash && existing.payload_hash !== payloadHash) return { status: 'conflict' }
        return { status: 'committed', entityId: existing.entity_id, delivery: canSend ? 'queued' : 'local_only', savedAt: existing.local_committed_at }
      }
      const report: LocalReport = {
        id: input.reportId,
        owner_id: scope.ownerId,
        environment_id: scope.environmentId,
        mission_id: profile.mission_id,
        title: input.title,
        range_start: input.rangeStart,
        range_end: input.rangeEnd,
        reason: input.reason,
        message: input.message,
        recipient_assignment_id: input.recipientAssignmentId,
        recipient_label: input.recipientLabel,
        general_snapshot: input.snapshot,
        general_hash: generalHash,
        parent_report_id: input.parentReportId,
        readiness: 'finalized',
        delivery,
        doctor_work: 'not_opened',
        operation_id: input.operationId,
        created_at_device: savedAt,
        accepted_at: null,
        opened_at: null,
        replied_at: null,
        checkin_ids: input.checkinIds,
      }
      await database.localReports.put(report)
      if (input.personal && personalHash) {
        const part: LocalPersonalReport = {
          id: input.reportId,
          owner_id: scope.ownerId,
          environment_id: scope.environmentId,
          personal_snapshot: input.personal.payload,
          personal_hash: personalHash,
          consent_event_id: input.personal.consentEventId,
          schema_version: 1,
        }
        await database.localPersonalReports.put(part)
      }
      if (canSend && frozen && payloadHash) {
        await enqueue(database, {
          operation_id: input.operationId,
          owner_id: scope.ownerId,
          environment_id: scope.environmentId,
          entity_type: 'report_bundle',
          entity_id: input.reportId,
          payload_version: 1,
          frozen_payload: frozen,
          payload_hash: payloadHash,
          dependencies: input.dependencies,
          state: 'pending',
          attempts: 0,
          next_attempt_at: savedAt,
          last_error_code: null,
          lease_until: null,
          created_at: savedAt,
        })
        await database.receipts.put({
          operation_id: input.operationId,
          owner_id: scope.ownerId,
          environment_id: scope.environmentId,
          entity_type: 'report_bundle',
          entity_id: input.reportId,
          payload_hash: payloadHash,
          local_committed_at: savedAt,
          server_receipt_id: null,
        })
      }
      await writeAudit(database, scope, 'report_saved', input.operationId, input.reportId, savedAt)
      return { status: 'committed', entityId: input.reportId, delivery, savedAt }
    },
  )
}

export async function listReports(database: ArtemiaDb, scope: Scope): Promise<LocalReport[]> {
  const rows = await database.localReports.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.filter((row) => sameOwner(row, scope)).sort((left, right) => right.created_at_device.localeCompare(left.created_at_device))
}

export async function readReport(database: ArtemiaDb, scope: Scope, reportId: string): Promise<LocalReport | null> {
  const row = await database.localReports.get(reportId)
  if (!row || !sameOwner(row, scope)) return null
  return row
}

export async function readPersonalReport(database: ArtemiaDb, scope: Scope, reportId: string): Promise<LocalPersonalReport | null> {
  const row = await database.localPersonalReports.get(reportId)
  if (!row || !sameOwner(row, scope)) return null
  return row
}

export async function saveReportStatus(database: ArtemiaDb, scope: Scope, report: LocalReport): Promise<void> {
  if (!sameOwner(report, scope)) return
  await database.localReports.put(report)
}

export async function listMessages(database: ArtemiaDb, scope: Scope, reportId: string): Promise<LocalMessage[]> {
  const rows = await database.localMessages.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.filter((row) => sameOwner(row, scope) && row.report_id === reportId)
}

export async function saveMessages(database: ArtemiaDb, scope: Scope, messages: LocalMessage[]): Promise<void> {
  await database.transaction('rw', database.localMessages, async () => {
    for (const message of messages) {
      if (!sameOwner(message, scope)) continue
      const existing = await database.localMessages.get(message.id)
      await database.localMessages.put({
        ...message,
        read_at: existing?.read_at ?? message.read_at,
        read_server_at: existing?.read_server_at ?? message.read_server_at ?? null,
      })
    }
  })
}

export async function queueReportAck(
  database: ArtemiaDb,
  scope: Scope,
  input: {
    reportId: string
    missionId: string
    ackType: 'device_received' | 'patient_read'
    messageId: string | null
    recordedAt: string
    operationId: string
  },
): Promise<{ status: 'queued' | 'duplicate' }> {
  const payload = reportAckSchema.parse({
    id: input.operationId,
    report_id: input.reportId,
    mission_id: input.missionId,
    ack_type: input.ackType,
    message_id: input.messageId,
    recorded_at: input.recordedAt,
    created_at_device: input.recordedAt,
  })
  const existing = await database.outbox
    .where('[owner_id+environment_id]')
    .equals([scope.ownerId, scope.environmentId])
    .filter((row) => {
      if (!sameOwner(row, scope) || row.entity_type !== 'report_ack') return false
      const frozen = row.frozen_payload as { ack_type?: string; report_id?: string; message_id?: string | null }
      return (
        frozen.ack_type === input.ackType &&
        frozen.report_id === input.reportId &&
        (input.ackType !== 'patient_read' || frozen.message_id === input.messageId)
      )
    })
    .first()
  if (existing) return { status: 'duplicate' }
  const hash = await hashOperation({ schemaVersion: SCHEMA_VERSION, type: 'report_ack', payload })
  const now = input.recordedAt
  await database.transaction('rw', [database.outbox, database.receipts, database.localAudit], async () => {
    await database.outbox.put({
      operation_id: input.operationId,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      entity_type: 'report_ack',
      entity_id: input.messageId ?? input.reportId,
      payload_version: SCHEMA_VERSION,
      frozen_payload: payload,
      payload_hash: hash,
      dependencies: [],
      state: 'pending',
      attempts: 0,
      next_attempt_at: now,
      last_error_code: null,
      lease_until: null,
      created_at: now,
    })
    await database.receipts.put({
      operation_id: input.operationId,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      entity_type: 'report_ack',
      entity_id: input.messageId ?? input.reportId,
      payload_hash: hash,
      local_committed_at: now,
      server_receipt_id: null,
    })
    await writeAudit(database, scope, `report_ack_${input.ackType}`, input.operationId, input.reportId, now)
  })
  return { status: 'queued' }
}

export async function markMessageRead(
  database: ArtemiaDb,
  scope: Scope,
  message: LocalMessage,
  missionId: string,
  readAt: string,
  operationId: string,
): Promise<void> {
  if (!sameOwner(message, scope)) return
  await database.localMessages.put({ ...message, read_at: readAt, read_server_at: message.read_server_at ?? null })
  await queueReportAck(database, scope, {
    reportId: message.report_id,
    missionId,
    ackType: 'patient_read',
    messageId: message.id,
    recordedAt: readAt,
    operationId,
  })
}

function cursorId(scope: Scope): string {
  return `${scope.ownerId}:${scope.environmentId}`
}

async function enqueueMeasurement(database: ArtemiaDb, scope: Scope, measurement: LocalMeasurement, savedAt: string): Promise<void> {
  const payload = measurementOperationSchema.parse({
    id: measurement.id,
    mission_id: measurement.mission_id,
    metric: measurement.metric,
    value: measurement.value,
    unit: measurement.unit,
    source: 'manual',
    quality: 'unknown',
    quality_reasons: measurement.quality_reasons,
    context: measurement.context,
    note: measurement.note,
    device_metadata: measurement.instrument ? { instrument: measurement.instrument } : null,
    algorithm_version: null,
    attempt_id: null,
    device_id: measurement.device_id,
    recorded_at: measurement.recorded_at,
    created_at_device: measurement.created_at_device,
    demo_dataset_id: measurement.demo_dataset_id,
  })
  if (!measurement.payload_hash) throw new Error('measurement_hash_missing')
  const payloadHash = measurement.payload_hash
  const existing = await database.outbox.get(measurement.operation_id)
  if (existing) return
  await enqueue(database, {
    operation_id: measurement.operation_id,
    owner_id: scope.ownerId,
    environment_id: scope.environmentId,
    entity_type: 'measurement',
    entity_id: measurement.id,
    payload_version: 1,
    frozen_payload: payload,
    payload_hash: payloadHash,
    dependencies: [],
    state: 'pending',
    attempts: 0,
    next_attempt_at: savedAt,
    last_error_code: null,
    lease_until: null,
    created_at: savedAt,
  })
}

async function enqueue(database: ArtemiaDb, item: OutboxItem): Promise<void> {
  if (!ALLOWED_OUTBOX.has(item.entity_type) || item.entity_type.includes('personal')) {
    throw new Error('outbox_type_rejected')
  }
  await database.outbox.put(item)
}

async function writeAudit(
  database: ArtemiaDb,
  scope: Scope,
  eventCode: string,
  operationId: string | null,
  entityId: string | null,
  recordedAt: string,
): Promise<void> {
  const row: LocalAudit = {
    id: crypto.randomUUID(),
    owner_id: scope.ownerId,
    environment_id: scope.environmentId,
    recorded_at: recordedAt,
    component: 'journal',
    event_code: eventCode,
    operation_id: operationId,
    entity_id: entityId,
  }
  await database.localAudit.put(row)
}

async function ownedCheckin(database: ArtemiaDb, scope: Scope, id: string): Promise<LocalCheckin | null> {
  const row = await database.localCheckins.get(id)
  if (!row || !sameOwner(row, scope)) return null
  return row
}

async function ownedMeasurement(database: ArtemiaDb, scope: Scope, id: string): Promise<LocalMeasurement | null> {
  const row = await database.localMeasurements.get(id)
  if (!row || !sameOwner(row, scope)) return null
  return row
}

function sameOwner(row: { owner_id: string; environment_id: string }, scope: { ownerId: string; environmentId: string }): boolean {
  return row.owner_id === scope.ownerId && row.environment_id === scope.environmentId
}

export type { OperationType, SourceCache, RuleCache }
