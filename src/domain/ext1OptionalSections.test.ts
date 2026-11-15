/**
 * EXT-1 / BASE: optional sections must not block a valid general check-in commit path.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGeneralPayload, emptyCheckinDraft, issuesForStep } from './checkinDraft.ts'
import { buildPersonalPayload } from './personalDraft.ts'

const now = new Date('2026-11-15T12:00:00.000Z')

test('skipped personal section yields no issues and no payload while general still builds', () => {
  const values = ready()
  values.personalFill = 'skip'
  const general = buildGeneralPayload(values, 'UTC', now)
  const personal = buildPersonalPayload(values, true)
  assert.equal(general.issues.length, 0)
  assert.ok(general.payload)
  assert.equal(personal.skipped, true)
  assert.equal(personal.payload, null)
  assert.equal(personal.issues.length, 0)
})

test('personal enabled=false skips without requiring personalFill', () => {
  const values = ready()
  const personal = buildPersonalPayload(values, false)
  assert.equal(personal.skipped, true)
  assert.deepEqual(personal.issues, [])
})

test('review step with personal off only checks general fields', () => {
  const values = ready()
  values.personalFill = null
  const issues = issuesForStep('review', values, 'UTC', now, false)
  assert.deepEqual(issues, [])
})

test('personal-step issues stay off the measurements step', () => {
  const values = ready()
  values.personalFill = null
  assert.deepEqual(issuesForStep('measurements', values, 'UTC', now, true), [])
  const personalIssues = issuesForStep('personal', values, 'UTC', now, true)
  assert.ok(personalIssues.some((issue) => issue.path === 'personalFill'))
})

test('optional nutrition section skip does not block checkin commit', () => {
  const values = ready()
  values.nutritionFill = 'skipped'
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.issues.length, 0)
  assert.ok(built.payload)
  assert.equal(built.payload?.nutrition.section_status, 'skipped')
  assert.equal(built.payload?.nutrition.fluid_ml, null)
})

test('nutrition step requires an explicit fill/skip choice', () => {
  const values = ready()
  values.nutritionFill = null
  const issues = issuesForStep('nutrition', values, 'UTC', now, false)
  assert.ok(issues.some((issue) => issue.path === 'nutritionFill'))
})

function ready() {
  const values = emptyCheckinDraft('daily', '2026-11-15T11:00')
  values.overallState = 'good'
  values.sleepHours = '8'
  values.sleepQualitySkip = true
  values.fatigueSkip = true
  values.stressSkip = true
  values.emotional = 'calm'
  values.symptomPresence = 'no'
  values.reviewRequested = false
  values.nutritionFill = 'skipped'
  return values
}
