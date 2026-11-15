import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectManualMeasurement } from './manualMeasurement.ts'

const identity = {
  id: '10000000-0000-4000-8000-000000000301',
  missionId: '10000000-0000-4000-8000-000000000010',
  deviceId: 'device-1',
  timeZone: 'UTC',
  now: new Date('2026-11-14T12:00:00.000Z'),
  demoDatasetId: null,
}

test('EU and US temperature drafts store comparable base celsius values', () => {
  const eu = inspectManualMeasurement(
    {
      metric: 'temperature',
      rawValue: '37',
      recordedAtLocal: '2026-11-14T12:00',
      context: 'rest',
      instrument: '',
      note: '',
    },
    { ...identity, unitSystem: 'metric' },
  )
  const us = inspectManualMeasurement(
    {
      metric: 'temperature',
      rawValue: '98.6',
      recordedAtLocal: '2026-11-14T12:00',
      context: 'rest',
      instrument: '',
      note: '',
    },
    { ...identity, unitSystem: 'us' },
  )
  assert.ok(eu.payload)
  assert.ok(us.payload)
  assert.equal(eu.payload?.unit, 'celsius')
  assert.equal(us.payload?.unit, 'celsius')
  assert.equal(eu.payload?.value, 37)
  assert.equal(us.payload?.value, 37)
  assert.equal(eu.payload?.input_unit, 'celsius')
  assert.equal(us.payload?.input_unit, 'fahrenheit')
  assert.equal(us.payload?.input_value, 98.6)
})

test('empty values stay empty when switching is not attempted here', () => {
  const empty = inspectManualMeasurement(
    {
      metric: 'temperature',
      rawValue: '',
      recordedAtLocal: '2026-11-14T12:00',
      context: 'rest',
      instrument: '',
      note: '',
    },
    { ...identity, unitSystem: 'us' },
  )
  assert.equal(empty.payload, null)
})
