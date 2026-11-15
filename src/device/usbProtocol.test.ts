import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateUsbAttempt, type UsbAttemptSample } from './usbQuality.ts'
import { parseUsbLine, pushUsbChunk } from './usbProtocol.ts'

describe('usbProtocol', () => {
  it('parses a sample line', () => {
    const line =
      '{"protocol_version":"1","type":"sample","device_id":"esp32.aabbccddeeff","firmware_version":"0.1.0","session_id":"11111111-1111-1111-1111-111111111111","seq":3,"uptime_ms":1200,"contact_detected":true,"raw_ir":50000,"raw_red":48000,"hr_bpm":72,"quality_flags":[]}'
    const parsed = parseUsbLine(line)
    assert.equal(parsed.kind, 'packet')
    if (parsed.kind !== 'packet' || parsed.packet.type !== 'sample') throw new Error('expected sample')
    assert.equal(parsed.packet.hr_bpm, 72)
    assert.equal(parsed.packet.contact_detected, true)
  })

  it('rejects unknown protocol', () => {
    const parsed = parseUsbLine(
      '{"protocol_version":"9","type":"hello","device_id":"esp32.x","firmware_version":"0.1.0","uptime_ms":1}',
    )
    assert.equal(parsed.kind, 'fatal')
  })

  it('buffers partial lines', () => {
    const lines: string[] = []
    let state = { text: '', badStreak: 0 }
    const first = pushUsbChunk(state, '{"protocol_version":"1","type":"hello",', (line) => lines.push(line))
    state = first.state
    const second = pushUsbChunk(
      state,
      '"device_id":"esp32.x","firmware_version":"0.1.0","uptime_ms":10}\n',
      (line) => lines.push(line),
    )
    assert.equal(second.fatal, undefined)
    assert.equal(lines.length, 1)
  })
})

describe('usbQuality', () => {
  it('marks short contact as insufficient', () => {
    const samples: UsbAttemptSample[] = []
    const start = 1_000
    for (let i = 0; i < 5; i += 1) {
      samples.push({
        atMs: start + i * 200,
        contact: true,
        saturated: false,
        hrBpm: 70 + i,
        rawIr: 50000,
        seq: i + 1,
      })
    }
    const result = evaluateUsbAttempt(samples)
    assert.equal(result.quality, 'insufficient')
    assert.equal(result.value, null)
  })

  it('returns median HR for a full usable window', () => {
    const samples: UsbAttemptSample[] = []
    const start = 1_000
    for (let i = 0; i < 120; i += 1) {
      samples.push({
        atMs: start + i * 250,
        contact: true,
        saturated: false,
        hrBpm: i % 2 === 0 ? 70 : 74,
        rawIr: 50000 + i,
        seq: i + 1,
      })
    }
    const result = evaluateUsbAttempt(samples)
    assert.equal(result.quality, 'valid')
    assert.ok(result.value === 70 || result.value === 72 || result.value === 74)
  })
})
