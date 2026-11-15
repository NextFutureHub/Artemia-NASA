import type { MeasurementQuality } from '../domain/enums.ts'
import { USB_ALGORITHM_VERSION, USB_COLLECT_MS, type UsbSamplePacket } from './usbProtocol.ts'

export type UsbAttemptSample = {
  atMs: number
  contact: boolean
  saturated: boolean
  hrBpm: number | null
  rawIr: number
  seq: number
}

export type UsbEvaluation = {
  quality: MeasurementQuality
  value: number | null
  reasons: string[]
  contactMs: number
  usableHrCount: number
  algorithmVersion: typeof USB_ALGORITHM_VERSION
  windowMs: number
}

const MIN_CONTACT_MS = 20_000
const MIN_HR_SAMPLES = 10

export function toAttemptSample(packet: UsbSamplePacket, atMs: number): UsbAttemptSample {
  return {
    atMs,
    contact: packet.contact_detected,
    saturated: packet.quality_flags.includes('saturation'),
    hrBpm: packet.hr_bpm,
    rawIr: packet.raw_ir,
    seq: packet.seq,
  }
}

/** Q1 demo quality: contact duration, usable HR estimates, no saturation. */
export function evaluateUsbAttempt(samples: UsbAttemptSample[], windowMs = USB_COLLECT_MS): UsbEvaluation {
  const reasons: string[] = []
  if (samples.length === 0) {
    return {
      quality: 'insufficient',
      value: null,
      reasons: ['no_samples'],
      contactMs: 0,
      usableHrCount: 0,
      algorithmVersion: USB_ALGORITHM_VERSION,
      windowMs,
    }
  }

  let contactMs = 0
  let gapFail = false
  let saturated = false
  const hrs: number[] = []

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]
    if (sample.saturated) saturated = true
    if (sample.contact && sample.hrBpm !== null && sample.hrBpm >= 20 && sample.hrBpm <= 250 && !sample.saturated) {
      hrs.push(sample.hrBpm)
    }
    if (i === 0) continue
    const prev = samples[i - 1]
    const dt = Math.max(0, sample.atMs - prev.atMs)
    if (dt > 2000) gapFail = true
    if (prev.contact && sample.contact) contactMs += dt
  }

  if (saturated) reasons.push('saturation')
  if (gapFail) reasons.push('stream_gap')
  if (contactMs < MIN_CONTACT_MS) reasons.push('contact_short')
  if (hrs.length < MIN_HR_SAMPLES) reasons.push('hr_sparse')

  if (saturated || gapFail || contactMs < MIN_CONTACT_MS || hrs.length < MIN_HR_SAMPLES) {
    return {
      quality: reasons.includes('contact_short') || reasons.includes('hr_sparse') ? 'insufficient' : 'invalid',
      value: null,
      reasons,
      contactMs,
      usableHrCount: hrs.length,
      algorithmVersion: USB_ALGORITHM_VERSION,
      windowMs,
    }
  }

  const sorted = [...hrs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]

  return {
    quality: 'valid',
    value: median,
    reasons: [],
    contactMs,
    usableHrCount: hrs.length,
    algorithmVersion: USB_ALGORITHM_VERSION,
    windowMs,
  }
}
