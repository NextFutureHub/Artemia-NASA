/**
 * EXT-1 lock: profile_preferences age / sex_context / unit_system contract.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOperationPayload } from './operation.ts'

function prefs(patch: Record<string, unknown> = {}) {
  return {
    locale: 'ru',
    timezone: 'UTC',
    age: 34,
    sex_context: 'female',
    reproductive_enabled: true,
    cycle_context: null,
    default_sharing: 'device_only',
    unit_system: 'metric',
    ...patch,
  }
}

test('profile_preferences accepts age, sex_context, and unit_system', () => {
  const parsed = parseOperationPayload('profile_preferences', prefs({ unit_system: 'us', age: 42 }))
  assert.equal(parsed.success, true)
  if (!parsed.success) return
  assert.equal(parsed.data.age, 42)
  assert.equal(parsed.data.sex_context, 'female')
  assert.equal(parsed.data.unit_system, 'us')
})

test('profile_preferences allows null age and sex_context', () => {
  const parsed = parseOperationPayload('profile_preferences', prefs({ age: null, sex_context: null }))
  assert.equal(parsed.success, true)
  if (!parsed.success) return
  assert.equal(parsed.data.age, null)
  assert.equal(parsed.data.sex_context, null)
})

test('profile_preferences rejects age outside 18–100 and unknown sex/unit', () => {
  assert.equal(parseOperationPayload('profile_preferences', prefs({ age: 17 })).success, false)
  assert.equal(parseOperationPayload('profile_preferences', prefs({ age: 101 })).success, false)
  assert.equal(parseOperationPayload('profile_preferences', prefs({ sex_context: 'other' })).success, false)
  assert.equal(parseOperationPayload('profile_preferences', prefs({ unit_system: 'imperial' })).success, false)
})

test('profile_preferences rejects extra keys', () => {
  assert.equal(parseOperationPayload('profile_preferences', prefs({ diagnosis: 'none' })).success, false)
})
