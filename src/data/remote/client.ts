const meta = import.meta as { env?: { VITE_ENVIRONMENT?: string; VITE_API_URL?: string } }
export const environmentId = meta.env?.VITE_ENVIRONMENT || 'demo'
export const apiUrl = (meta.env?.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

export type ApiResult = { ok: boolean; status: number; body: unknown; retryAfterSeconds: number | null }

export async function apiRequest(
  path: string,
  options: { method?: string; token?: string; body?: unknown; cache?: RequestCache } = {},
): Promise<ApiResult> {
  const headers = new Headers()
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  headers.set('Cache-Control', 'no-store')
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: options.cache ?? 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    const text = await response.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text) as unknown
      } catch {
        body = null
      }
    }
    const retryAfter = response.headers.get('retry-after')
    const retryAfterSeconds = retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null
    return { ok: response.ok, status: response.status, body, retryAfterSeconds }
  } catch {
    return { ok: false, status: 0, body: null, retryAfterSeconds: null }
  }
}
