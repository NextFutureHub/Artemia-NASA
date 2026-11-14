import { hashOperation } from '../../domain/canonicalJson.ts'
import type { CareOrderCard, CareOrderResponsePayload } from '../../domain/careOrder.ts'
import type { ArtemiaDb } from './db.ts'
import type { LocalCareOrder, OutboxItem, Scope } from './types.ts'

function sameOwner(row: { owner_id: string; environment_id: string }, scope: Scope): boolean {
  return row.owner_id === scope.ownerId && row.environment_id === scope.environmentId
}

export function cardToLocal(scope: Scope, card: CareOrderCard): LocalCareOrder {
  const latest = card.responses[0] ?? null
  return {
    id: card.id,
    owner_id: scope.ownerId,
    environment_id: scope.environmentId,
    mission_id: card.mission_id,
    assignment_id: card.assignment_id,
    doctor_id: card.doctor_id,
    kind: card.kind,
    title: card.title,
    instructions: card.instructions,
    schedule_text: card.schedule_text,
    due_at: card.due_at,
    status: card.status,
    revision_no: card.revision_no,
    cancelled_reason: card.cancelled_reason,
    revise_reason: card.revise_reason,
    ack_required: card.ack_required,
    acknowledged_at: card.acknowledged_at,
    created_at: card.created_at,
    updated_at: card.updated_at,
    last_decision: latest?.decision ?? null,
    last_note: latest?.note ?? null,
    last_response_at: latest?.recorded_at ?? null,
  }
}

export async function replaceCareOrders(database: ArtemiaDb, scope: Scope, cards: CareOrderCard[]): Promise<void> {
  await database.transaction('rw', database.localCareOrders, async () => {
    const existing = await database.localCareOrders.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
    for (const row of existing) {
      if (sameOwner(row, scope)) await database.localCareOrders.delete(row.id)
    }
    for (const card of cards) {
      await database.localCareOrders.put(cardToLocal(scope, card))
    }
  })
}

export async function listCareOrders(database: ArtemiaDb, scope: Scope): Promise<LocalCareOrder[]> {
  const rows = await database.localCareOrders.where('[owner_id+environment_id]').equals([scope.ownerId, scope.environmentId]).toArray()
  return rows.filter((row) => sameOwner(row, scope)).sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

export async function commitCareOrderResponse(
  database: ArtemiaDb,
  scope: Scope,
  order: LocalCareOrder,
  payload: CareOrderResponsePayload,
  operationId: string,
): Promise<{ status: 'committed' } | { status: 'rejected'; reason: string }> {
  if (!sameOwner(order, scope)) return { status: 'rejected', reason: 'owner_mismatch' }
  const hash = await hashOperation({ schemaVersion: 1, type: 'care_order_response', payload })
  const now = new Date().toISOString()
  const outbox: OutboxItem = {
    operation_id: operationId,
    owner_id: scope.ownerId,
    environment_id: scope.environmentId,
    entity_type: 'care_order_response',
    entity_id: payload.id,
    payload_version: 1,
    frozen_payload: payload,
    payload_hash: hash,
    dependencies: [],
    state: 'pending',
    attempts: 0,
    next_attempt_at: now,
    last_error_code: null,
    lease_until: null,
    created_at: now,
  }
  await database.transaction('rw', [database.localCareOrders, database.outbox, database.receipts, database.localAudit], async () => {
    const next: LocalCareOrder = {
      ...order,
      last_decision: payload.decision,
      last_note: payload.note,
      last_response_at: payload.recorded_at,
      updated_at: now,
    }
    if (payload.decision === 'acknowledged') {
      next.ack_required = false
      next.acknowledged_at = payload.recorded_at
    } else {
      next.status = 'completed'
    }
    await database.localCareOrders.put(next)
    await database.outbox.put(outbox)
    await database.receipts.put({
      operation_id: operationId,
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      entity_type: 'care_order_response',
      entity_id: payload.id,
      payload_hash: hash,
      local_committed_at: now,
      server_receipt_id: null,
    })
    await database.localAudit.put({
      id: crypto.randomUUID(),
      owner_id: scope.ownerId,
      environment_id: scope.environmentId,
      recorded_at: now,
      component: 'care_orders',
      event_code: `care_${payload.decision}`,
      operation_id: operationId,
      entity_id: order.id,
    })
  })
  return { status: 'committed' }
}
