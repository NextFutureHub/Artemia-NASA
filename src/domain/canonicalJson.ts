import { SCHEMA_VERSION } from './schemaVersion.ts'

/**
 * Canonical JSON: sorted keys, UTF-8. JSON.stringify keeps null,
 * Unicode, and decimal numbers. Omitting a field with undefined is forbidden.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Hash of the whole operation: type, schema_version, and the frozen payload. */
export async function hashOperation(input: {
  schemaVersion: number
  type: string
  payload: unknown
}): Promise<string> {
  return sha256Hex(
    canonicalJson({
      payload: input.payload,
      schema_version: input.schemaVersion,
      type: input.type,
    }),
  )
}

/** Hash of one record part. Server receipts and statuses are not included. */
export async function hashPayloadPart(payload: unknown, schemaVersion: number = SCHEMA_VERSION): Promise<string> {
  return sha256Hex(
    canonicalJson({
      payload,
      schema_version: schemaVersion,
    }),
  )
}

function normalize(value: unknown): unknown {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non_finite_number')
    return value
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item))
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Error('unsupported_object')
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) throw new Error('undefined_value')
      sorted[key] = normalize(source[key])
    }
    return sorted
  }
  throw new Error('unsupported_value')
}
