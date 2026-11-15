/** USB JSON Lines contract for ESP32 + MAX30102 (protocol_version "1"). */

export const USB_PROTOCOL_VERSION = '1'
export const USB_BAUD = 115200
export const USB_COLLECT_MS = 30_000
export const USB_STALE_MS = 2_000
export const USB_MAX_LINE = 4096
export const USB_MAX_BAD_LINES = 5
export const USB_ALGORITHM_VERSION = 'Q1-v1'

export type UsbQualityFlag = 'no_contact' | 'saturation' | string

export type UsbHelloPacket = {
  protocol_version: string
  type: 'hello'
  device_id: string
  firmware_version: string
  uptime_ms: number
}

export type UsbSamplePacket = {
  protocol_version: string
  type: 'sample'
  device_id: string
  firmware_version: string
  session_id: string
  seq: number
  uptime_ms: number
  contact_detected: boolean
  raw_ir: number
  raw_red: number | null
  hr_bpm: number | null
  quality_flags: UsbQualityFlag[]
}

export type UsbErrorPacket = {
  protocol_version: string
  type: 'error'
  device_id: string
  firmware_version: string
  code: string
  uptime_ms: number
}

export type UsbPacket = UsbHelloPacket | UsbSamplePacket | UsbErrorPacket

export type UsbParseResult =
  | { kind: 'packet'; packet: UsbPacket }
  | { kind: 'ignore'; reason: string }
  | { kind: 'fatal'; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseUsbLine(line: string): UsbParseResult {
  const trimmed = line.trim()
  if (!trimmed) return { kind: 'ignore', reason: 'empty' }
  if (trimmed.length > USB_MAX_LINE) return { kind: 'fatal', reason: 'line_too_long' }
  let raw: unknown
  try {
    raw = JSON.parse(trimmed) as unknown
  } catch {
    return { kind: 'ignore', reason: 'json' }
  }
  if (!isRecord(raw)) return { kind: 'ignore', reason: 'not_object' }
  if (raw.protocol_version !== USB_PROTOCOL_VERSION) {
    return { kind: 'fatal', reason: 'unknown_protocol' }
  }
  if (typeof raw.device_id !== 'string' || raw.device_id.length === 0 || raw.device_id.length > 128) {
    return { kind: 'ignore', reason: 'device_id' }
  }
  if (typeof raw.firmware_version !== 'string') return { kind: 'ignore', reason: 'firmware' }
  if (typeof raw.uptime_ms !== 'number' || !Number.isFinite(raw.uptime_ms)) {
    return { kind: 'ignore', reason: 'uptime' }
  }

  if (raw.type === 'hello') {
    return {
      kind: 'packet',
      packet: {
        protocol_version: USB_PROTOCOL_VERSION,
        type: 'hello',
        device_id: raw.device_id,
        firmware_version: raw.firmware_version,
        uptime_ms: raw.uptime_ms,
      },
    }
  }

  if (raw.type === 'error') {
    return {
      kind: 'packet',
      packet: {
        protocol_version: USB_PROTOCOL_VERSION,
        type: 'error',
        device_id: raw.device_id,
        firmware_version: raw.firmware_version,
        code: typeof raw.code === 'string' ? raw.code : 'unknown',
        uptime_ms: raw.uptime_ms,
      },
    }
  }

  if (raw.type === 'sample') {
    if (typeof raw.session_id !== 'string' || typeof raw.seq !== 'number') {
      return { kind: 'ignore', reason: 'sample_ids' }
    }
    if (typeof raw.contact_detected !== 'boolean' || typeof raw.raw_ir !== 'number') {
      return { kind: 'ignore', reason: 'sample_fields' }
    }
    const hr = raw.hr_bpm
    if (hr !== null && (typeof hr !== 'number' || !Number.isFinite(hr))) {
      return { kind: 'ignore', reason: 'hr' }
    }
    const flags = Array.isArray(raw.quality_flags)
      ? raw.quality_flags.filter((item): item is string => typeof item === 'string')
      : []
    return {
      kind: 'packet',
      packet: {
        protocol_version: USB_PROTOCOL_VERSION,
        type: 'sample',
        device_id: raw.device_id,
        firmware_version: raw.firmware_version,
        session_id: raw.session_id,
        seq: raw.seq,
        uptime_ms: raw.uptime_ms,
        contact_detected: raw.contact_detected,
        raw_ir: raw.raw_ir,
        raw_red: typeof raw.raw_red === 'number' ? raw.raw_red : null,
        hr_bpm: hr === null ? null : Math.round(hr),
        quality_flags: flags,
      },
    }
  }

  return { kind: 'ignore', reason: 'unknown_type' }
}

export type LineBufferState = { text: string; badStreak: number }

export function pushUsbChunk(
  state: LineBufferState,
  chunk: string,
  onLine: (line: string) => void,
): { state: LineBufferState; fatal?: string } {
  let text = state.text + chunk
  let badStreak = state.badStreak
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\n') continue
    const line = text.slice(start, i).replace(/\r$/, '')
    start = i + 1
    if (!line.trim()) continue
    const parsed = parseUsbLine(line)
    if (parsed.kind === 'fatal') return { state: { text: '', badStreak: 0 }, fatal: parsed.reason }
    if (parsed.kind === 'ignore') {
      badStreak += 1
      if (badStreak >= USB_MAX_BAD_LINES) {
        return { state: { text: '', badStreak: 0 }, fatal: 'too_many_bad_lines' }
      }
      continue
    }
    badStreak = 0
    onLine(line)
  }
  const rest = text.slice(start)
  if (rest.length > USB_MAX_LINE) return { state: { text: '', badStreak: 0 }, fatal: 'line_too_long' }
  return { state: { text: rest, badStreak } }
}
