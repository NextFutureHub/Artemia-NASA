import { parseCareOrders } from '../domain/careOrder.ts'
import { apiRequest } from '../data/remote/client.ts'
import { replaceCareOrders } from '../data/local/careOrders.ts'
import type { ArtemiaDb } from '../data/local/db.ts'
import { applyOutboxResult, claimNextOutbox, commitSyncCursor, readSyncCursor } from '../data/local/journal.ts'
import type { OutboxItem, Scope } from '../data/local/types.ts'
import { retryDelayMs } from './backoff.ts'

export type OperationResponse = { status: number; body: unknown; retryAfterSeconds: number | null }

type DeliveryClock = {
  database: ArtemiaDb
  scope: Scope
  sessionUserId: string | null
  token: string | null
  manual: boolean
  now: () => string
  random: () => number
  postOperation: (body: unknown, token: string) => Promise<OperationResponse>
  pullChanges: (cursor: string, token: string) => Promise<OperationResponse>
  refreshSession: () => Promise<boolean>
}

export async function runDelivery(input: DeliveryClock): Promise<void> {
  if (!input.sessionUserId || input.sessionUserId !== input.scope.ownerId || !input.token) return
  const token = input.token
  await withOwnerLock(input.scope.ownerId, async () => {
    const deferred = new Set<string>()
    for (let step = 0; step < 20; step += 1) {
      const claimed = await claimNextOutbox(input.database, input.scope, input.now(), {
        manual: input.manual,
        sessionMatches: true,
        skip: [...deferred],
      })
      if (!claimed) break
      if (personalSendBlocked(claimed.frozen_payload)) {
        await applyOutboxResult(input.database, input.scope, claimed, {
          state: 'blocked_permission',
          attempts: claimed.attempts,
          nextAttemptAt: input.now(),
          errorCode: 'personal_not_sent',
          serverReceiptId: null,
        })
        continue
      }
      const response = await postOnce(input, claimed, token)
      const decision = decide(claimed, response, input.random(), Date.parse(input.now()))
      if (decision.retry) deferred.add(claimed.operation_id)
      await applyOutboxResult(input.database, input.scope, claimed, decision.patch)
    }
    await pullOwnChanges(input, token)
    await refreshCareOrders(input, token)
  })
}

async function refreshCareOrders(input: DeliveryClock, token: string): Promise<void> {
  const response = await apiRequest('/care-orders', { token })
  if (response.status !== 200) return
  const cards = parseCareOrders(response.body)
  await replaceCareOrders(input.database, input.scope, cards)
}

export function browserDelivery(database: ArtemiaDb, scope: Scope, sessionUserId: string | null, token: string | null, manual: boolean): Promise<void> {
  return runDelivery({
    database,
    scope,
    sessionUserId,
    token,
    manual,
    now: () => new Date().toISOString(),
    random: () => Math.random(),
    postOperation: async (body, currentToken) => apiRequest('/operations', { method: 'POST', token: currentToken, body }),
    pullChanges: async (cursor, currentToken) => apiRequest(`/pull?cursor=${encodeURIComponent(cursor)}&limit=100`, { token: currentToken }),
    refreshSession: async () => false,
  })
}

async function postOnce(input: DeliveryClock, claimed: OutboxItem, token: string): Promise<OperationResponse> {
  const response = await input.postOperation(operationBody(claimed), token)
  if (response.status !== 401) return response
  const refreshed = await input.refreshSession()
  if (!refreshed) return response
  const again = await input.postOperation(operationBody(claimed), token)
  return again
}

function operationBody(item: OutboxItem): unknown {
  return {
    operation_id: item.operation_id,
    type: item.entity_type,
    schema_version: item.payload_version,
    payload: item.frozen_payload,
    hash: item.payload_hash,
    dependencies: item.dependencies,
  }
}

function decide(item: OutboxItem, response: OperationResponse, random: number, nowMs: number): {
  retry: boolean
  patch: { state: OutboxItem['state']; attempts: number; nextAttemptAt: string; errorCode: string | null; serverReceiptId: string | null }
} {
  const body = response.body && typeof response.body === 'object' ? (response.body as Record<string, unknown>) : null
  const code = typeof body?.error_code === 'string' ? body.error_code : null
  const attempts = item.attempts + 1
  const receipt = typeof body?.receipt_id === 'string' ? body.receipt_id : null
  const remoteHash = typeof body?.payload_hash === 'string' ? body.payload_hash : null
  const accepted = response.status === 200 && (body?.status === 'accepted' || body?.status === 'duplicate') && receipt !== null && remoteHash === item.payload_hash
  if (accepted && receipt) {
    return { retry: false, patch: { state: 'accepted', attempts, nextAttemptAt: new Date(nowMs).toISOString(), errorCode: null, serverReceiptId: receipt } }
  }
  if (response.status === 200) {
    return { retry: false, patch: { state: 'conflict', attempts, nextAttemptAt: new Date(nowMs).toISOString(), errorCode: remoteHash === item.payload_hash ? 'receipt_missing' : 'hash_mismatch', serverReceiptId: null } }
  }
  if (response.status === 401) {
    return { retry: false, patch: { state: 'blocked_auth', attempts, nextAttemptAt: new Date(nowMs).toISOString(), errorCode: 'not_authenticated', serverReceiptId: null } }
  }
  if (response.status === 403 || body?.status === 'forbidden') {
    return { retry: false, patch: { state: 'blocked_permission', attempts, nextAttemptAt: new Date(nowMs).toISOString(), errorCode: code ?? 'forbidden', serverReceiptId: null } }
  }
  if (response.status === 409 || body?.status === 'conflict') {
    return { retry: false, patch: { state: 'conflict', attempts, nextAttemptAt: new Date(nowMs).toISOString(), errorCode: code ?? 'conflict', serverReceiptId: null } }
  }
  if (response.status === 422) {
    return { retry: false, patch: { state: 'validation_error', attempts, nextAttemptAt: new Date(nowMs).toISOString(), errorCode: code ?? 'validation_error', serverReceiptId: null } }
  }
  const delay = response.status === 429 && response.retryAfterSeconds !== null ? response.retryAfterSeconds * 1000 : retryDelayMs(attempts, random)
  return {
    retry: true,
    patch: { state: 'retry_wait', attempts, nextAttemptAt: new Date(nowMs + delay).toISOString(), errorCode: response.status === 0 ? 'network' : `http_${response.status}`, serverReceiptId: null },
  }
}

async function pullOwnChanges(input: DeliveryClock, token: string): Promise<void> {
  const cursor = await readSyncCursor(input.database, input.scope)
  const response = await input.pullChanges(cursor, token)
  if (response.status !== 200 || !response.body || typeof response.body !== 'object') return
  const body = response.body as { events?: unknown; next_cursor?: unknown }
  if (!Array.isArray(body.events) || typeof body.next_cursor !== 'string') return
  const ids = body.events.flatMap((event) => {
    if (!event || typeof event !== 'object') return []
    const id = (event as { entity_id?: unknown }).entity_id
    return typeof id === 'string' ? [id] : []
  })
  await commitSyncCursor(input.database, input.scope, body.next_cursor, ids, input.now())
}

const SENSITIVE_KEYS = new Set([
  'bleeding_category',
  'bleeding_intensity',
  'cycle_context',
  'discomfort_score',
  'personal_payload',
  'personal_snapshot',
])

/** A consented personal part may travel. A leak into the general snapshot may not. */
export function personalSendBlocked(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const body = payload as {
    personal?: unknown
    revision?: { general_payload?: unknown }
    report?: { general_snapshot?: unknown }
  }
  if (hasSensitiveKey(body.revision?.general_payload) || hasSensitiveKey(body.report?.general_snapshot)) return true
  if (body.personal == null) return false
  if (typeof body.personal !== 'object') return true
  const consent = (body.personal as { consent_event_id?: unknown }).consent_event_id
  return typeof consent !== 'string' || consent.length === 0
}

function hasSensitiveKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => hasSensitiveKey(item))
  return Object.entries(value).some(([key, nested]) => SENSITIVE_KEYS.has(key) || hasSensitiveKey(nested))
}

async function withOwnerLock(ownerId: string, work: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) {
    await work()
    return
  }
  await locks.request(`artemia-delivery:${ownerId}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return
    await work()
  })
}
