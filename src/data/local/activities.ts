import { hashOperation } from '../../domain/canonicalJson.ts'
import { activityPayloadSchema, type ActivityPayload } from '../../domain/activityPayload.ts'
import { buildCareOrderResponse } from '../../domain/careOrder.ts'
import { SCHEMA_VERSION } from '../../domain/schemaVersion.ts'
import type { ArtemiaDb } from './db.ts'
import type { LocalActivity, LocalAudit, LocalCareOrder, LocalDelivery, OutboxItem, Scope } from './types.ts'

export type ActivityCommitStatus =
  | { status: 'committed'; entityId: string; delivery: LocalDelivery; savedAt: string; careResponseQueued: boolean }
  | { status: 'conflict' }
  | { status: 'rejected'; reason: string }

/**
 * Persist an activity payload offline.
 * Standalone rows stay local_only (no server activity op yet).
 * Task-linked rows also enqueue one care_order_response with the same activity_id (E10).
 */
export async function commitActivity(
  database: ArtemiaDb,
  scope: Scope,
  input: {
    operationId: string
    payload: ActivityPayload
    careOrder: LocalCareOrder | null
    responseOperationId?: string
  },
): Promise<ActivityCommitStatus> {
  const parsed = activityPayloadSchema.safeParse(input.payload)
  if (!parsed.success) return { status: 'rejected', reason: 'invalid_activity' }
  const payload = parsed.data

  if (payload.care_order_id === null && input.careOrder !== null) {
    return { status: 'rejected', reason: 'standalone_care_order_forbidden' }
  }
  if (payload.care_order_id !== null) {
    if (!input.careOrder || input.careOrder.id !== payload.care_order_id) {
      return { status: 'rejected', reason: 'care_order_mismatch' }
    }
    if (!sameOwner(input.careOrder, scope)) return { status: 'rejected', reason: 'owner_mismatch' }
  }

  const payloadHash = await hashOperation({
    schemaVersion: SCHEMA_VERSION,
    type: 'activity',
    payload,
  })
  const savedAt = new Date().toISOString()
  const linked = Boolean(payload.care_order_id && input.careOrder)
  const responseOperationId = linked ? (input.responseOperationId ?? crypto.randomUUID()) : null

  let responsePayload = null as ReturnType<typeof buildCareOrderResponse>['payload']
  let responseHash: string | null = null
  if (linked && input.careOrder && responseOperationId) {
    const decision = payload.completion === 'skipped' ? 'skipped' : 'done'
    const built = buildCareOrderResponse({
      id: crypto.randomUUID(),
      orderId: input.careOrder.id,
      missionId: input.careOrder.mission_id,
      decision,
      note: payload.comment,
      linkNote: null,
      activityId: payload.id,
      recordedAt: payload.started_at,
      createdAtDevice: savedAt,
    })
    if (!built.payload) return { status: 'rejected', reason: 'invalid_care_response' }
    responsePayload = built.payload
    responseHash = await hashOperation({
      schemaVersion: SCHEMA_VERSION,
      type: 'care_order_response',
      payload: responsePayload,
    })
  }

  const tables = [
    database.localActivities,
    database.localCareOrders,
    database.outbox,
    database.receipts,
    database.localAudit,
  ]

  return database.transaction('rw', tables, async () => {
    const existing = await database.receipts.get(input.operationId)
    if (existing && !sameOwner(existing, scope)) return { status: 'conflict' as const }
    if (existing) {
      if (existing.payload_hash !== payloadHash) return { status: 'conflict' as const }
      const row = await database.localActivities.get(existing.entity_id)
      return {
        status: 'committed' as const,
        entityId: existing.entity_id,
        delivery: row?.delivery ?? 'local_only',
        savedAt: existing.local_committed_at,
        careResponseQueued: Boolean(row?.care_response_operation_id),
      }
    }

    const foreign = await database.localActivities.get(payload.id)
    if (foreign && !sameOwner(foreign, scope)) return { status: 'rejected' as const, reason: 'activity_not_owned' }

    const delivery: LocalDelivery = 'local_only'
    const row: LocalActivity = {
      id: payload.id,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      operation_id: input.operationId,
      mission_id: payload.mission_id,
      payload,
      schema_version: 1,
      delivery,
      payload_hash: payloadHash,
      created_at_device: savedAt,
      care_response_operation_id: responseOperationId,
    }
    await database.localActivities.put(row)
    await database.receipts.put({
      operation_id: input.operationId,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      entity_type: 'activity',
      entity_id: payload.id,
      payload_hash: payloadHash,
      local_committed_at: savedAt,
      server_receipt_id: null,
    })
    await writeAudit(database, scope, 'activity_saved', input.operationId, payload.id, savedAt)

    if (linked && input.careOrder && responsePayload && responseHash && responseOperationId) {
      const next: LocalCareOrder = {
        ...input.careOrder,
        last_decision: responsePayload.decision,
        last_note: responsePayload.note,
        last_response_at: responsePayload.recorded_at,
        updated_at: savedAt,
        status: 'completed',
      }
      await database.localCareOrders.put(next)
      const outbox: OutboxItem = {
        operation_id: responseOperationId,
        owner_id: scope.ownerId,
        environment_id: scope.environmentId,
        entity_type: 'care_order_response',
        entity_id: responsePayload.id,
        payload_version: 1,
        frozen_payload: responsePayload,
        payload_hash: responseHash,
        dependencies: [],
        state: 'pending',
        attempts: 0,
        next_attempt_at: savedAt,
        last_error_code: null,
        lease_until: null,
        created_at: savedAt,
      }
      await database.outbox.put(outbox)
      await database.receipts.put({
        operation_id: responseOperationId,
        owner_id: scope.ownerId,
        environment_id: scope.environmentId,
        entity_type: 'care_order_response',
        entity_id: responsePayload.id,
        payload_hash: responseHash,
        local_committed_at: savedAt,
        server_receipt_id: null,
      })
      await writeAudit(database, scope, `care_${responsePayload.decision}`, responseOperationId, input.careOrder.id, savedAt)
    }

    return {
      status: 'committed' as const,
      entityId: payload.id,
      delivery,
      savedAt,
      careResponseQueued: Boolean(responseOperationId),
    }
  })
}

export async function listActivities(database: ArtemiaDb, scope: Scope): Promise<LocalActivity[]> {
  const rows = await database.localActivities.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows
    .filter((row) => sameOwner(row, scope))
    .sort((left, right) => right.payload.started_at.localeCompare(left.payload.started_at))
}

export async function readActivity(database: ArtemiaDb, scope: Scope, activityId: string): Promise<LocalActivity | null> {
  const row = await database.localActivities.get(activityId)
  if (!row || !sameOwner(row, scope)) return null
  return row
}

function sameOwner(row: { owner_id: string; environment_id: string }, scope: Scope): boolean {
  return row.owner_id === scope.ownerId && row.environment_id === scope.environmentId
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
    component: 'activities',
    event_code: eventCode,
    operation_id: operationId,
    entity_id: entityId,
  }
  await database.localAudit.put(row)
}
