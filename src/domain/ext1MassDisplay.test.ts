/**
 * EXT-1: body mass metric stores kg; US UI shows lb.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { METRICS } from './enums.ts'
import { inspectManualMeasurement } from './manualMeasurement.ts'
import {
  formatMassFromKg,
  kgToLb,
  lbToKg,
  massDisplayUnit,
  massDraftToKg,
  switchDraftField,
} from './unitSystem.ts'

test('mass display unit follows metric kg / us lb', () => {
  assert.equal(massDisplayUnit('metric'), 'kg')
  assert.equal(massDisplayUnit('us'), 'lb')
})

test('operation METRICS include body_mass', () => {
  assert.equal((METRICS as readonly string[]).includes('body_mass'), true)
})

test('body_mass measurement stores kg base with US input metadata', () => {
  const inspected = inspectManualMeasurement(
    {
      metric: 'body_mass',
      rawValue: '154.3',
      recordedAtLocal: '2026-11-15T10:00',
      context: 'rest',
      instrument: 'mass measurement',
      note: '',
    },
    {
      id: '11111111-1111-4111-8111-111111111111',
      missionId: '22222222-2222-4222-8222-222222222222',
      deviceId: 'device-1',
      timeZone: 'UTC',
      now: new Date('2026-11-15T10:00:00.000Z'),
      demoDatasetId: null,
      unitSystem: 'us',
    },
  )
  assert.ok(inspected.payload)
  assert.equal(inspected.payload?.metric, 'body_mass')
  assert.equal(inspected.payload?.unit, 'kg')
  assert.equal(inspected.payload?.input_unit, 'lb')
  assert.ok(Math.abs((inspected.payload?.value ?? 0) - lbToKg(154.3)) < 0.05)
})

test('base kg formats for US without inventing a second stored unit', () => {
  assert.equal(formatMassFromKg(70, 'metric'), '70')
  assert.equal(formatMassFromKg(70, 'us'), formatOne(kgToLb(70)))
  assert.equal(formatMassFromKg(null, 'us'), '')
})

test('US draft converts to base kg; metric draft stays kg', () => {
  const fromLb = massDraftToKg('154.3', 'us')
  assert.ok(fromLb !== null)
  assert.ok(Math.abs((fromLb as number) - lbToKg(154.3)) < 1e-9)
  assert.equal(massDraftToKg('70', 'metric'), 70)
  assert.equal(massDraftToKg('', 'us'), null)
})

test('mass draft unit switches round-trip without inventing values', () => {
  const toUs = switchDraftField('mass', '70', 'metric', 'us')
  assert.equal(toUs.ok, true)
  if (!toUs.ok) return
  const back = switchDraftField('mass', toUs.next, 'us', 'metric')
  assert.equal(back.ok, true)
  if (!back.ok) return
  assert.equal(back.next, '70')
})

test('incomplete mass draft blocks unit switch', () => {
  const blocked = switchDraftField('mass', '70.', 'metric', 'us')
  assert.equal(blocked.ok, false)
})

function formatOne(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
