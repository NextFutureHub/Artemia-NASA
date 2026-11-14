import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyCheckinDraft, buildGeneralPayload } from './checkinDraft.ts'
import { buildPersonalPayload, emptyPersonalFields } from './personalDraft.ts'

test('turning the personal step off leaves a normal check-in payload', () => {
  const values = emptyCheckinDraft('daily', '2026-11-14T11:00')
  values.overallState = 'good'
  values.sleepHours = '7'
  values.sleepQualitySkip = true
  values.fatigue = 0
  values.fatigueSkip = false
  values.stressSkip = true
  values.emotional = 'calm'
  values.symptomPresence = 'no'
  values.reviewRequested = false
  const general = buildGeneralPayload(values, 'UTC', new Date('2026-11-14T12:00:00.000Z'))
  const personal = buildPersonalPayload(values, false)
  assert.equal(general.issues.length, 0)
  assert.equal(general.payload?.fatigue_score, 0)
  assert.equal(personal.skipped, true)
  assert.equal(personal.payload, null)
})

test('a skipped personal section is not stored as a no-problem conclusion', () => {
  const values = emptyPersonalFields()
  values.personalFill = 'skip'
  const built = buildPersonalPayload(values, true)
  assert.equal(built.skipped, true)
  assert.equal(built.payload, null)
  assert.equal(built.issues.length, 0)
})

test('device-only sharing stays outside the personal payload', () => {
  const values = emptyPersonalFields('device_only')
  values.personalFill = 'yes'
  values.bleeding = 'none'
  values.discomfort = 0
  values.discomfortSkip = false
  const built = buildPersonalPayload(values, true)
  assert.equal(built.issues.length, 0)
  assert.equal(built.payload?.discomfort_score, 0)
  assert.equal(built.payload?.bleeding_intensity, null)
  assert.equal(built.payload?.bleeding_intensity_answer_status, 'not_applicable')
  assert.equal(Object.hasOwn(built.payload ?? {}, 'sharing_mode'), false)
})

test('sharing with the physician is a separate choice from the general checkbox', () => {
  const local = emptyPersonalFields('device_only')
  local.personalFill = 'yes'
  const shared = emptyPersonalFields('assigned_doctor')
  shared.personalFill = 'yes'
  const left = buildPersonalPayload(local, true).payload
  const right = buildPersonalPayload(shared, true).payload
  assert.deepEqual(left, right)
})
