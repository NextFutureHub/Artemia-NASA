import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGeneralPayload, emptyCheckinDraft, type CheckinDraftValues } from './checkinDraft.ts'

const now = new Date('2026-11-14T12:00:00.000Z')

test('zero stays zero and an explicit skip stays null', () => {
  const values = readyDraft()
  values.fatigue = 0
  values.fatigueSkip = false
  values.stress = null
  values.stressSkip = true
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.issues.length, 0)
  assert.equal(built.payload?.fatigue_score, 0)
  assert.equal(built.payload?.fatigue_answer_status, 'answered')
  assert.equal(built.payload?.stress_score, null)
  assert.equal(built.payload?.stress_answer_status, 'declined')
})

test('a time more than five minutes ahead is rejected and left unchanged', () => {
  const values = readyDraft()
  values.recordedAtLocal = '2026-11-14T12:06'
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.payload, null)
  assert.equal(built.issues.some((issue) => issue.message === 'future_limit'), true)
  assert.equal(values.recordedAtLocal, '2026-11-14T12:06')
})

test('symptom Other without a label fails on that field', () => {
  const values = readyDraft()
  values.symptomPresence = 'yes'
  values.symptoms = [
    {
      code: 'other',
      customLabel: ' ',
      severity: 3,
      severitySkip: false,
      onset: 'now',
      persistence: 'constant',
      impact: 'none',
      comment: '',
    },
  ]
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.payload, null)
  assert.equal(
    built.issues.some((issue) => issue.path === 'symptoms.0.customLabel'),
    true,
  )
})

function readyDraft(): CheckinDraftValues {
  const values = emptyCheckinDraft('daily', '2026-11-14T11:00')
  values.overallState = 'fair'
  values.sleepHours = '7.5'
  values.sleepQualitySkip = true
  values.fatigue = 0
  values.stressSkip = true
  values.emotional = 'calm'
  values.symptomPresence = 'no'
  values.reviewRequested = false
  values.nutritionFill = 'skipped'
  return values
}
