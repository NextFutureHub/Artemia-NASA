/**
 * EXT-1: sleep/nutrition draft rules, change-path skip, fluid 0 vs not_tracked.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGeneralPayload, checkinSteps, emptyCheckinDraft, issuesForStep } from './checkinDraft.ts'
import { generalPayloadSchema, skippedNutrition } from './generalPayload.ts'
import { baseGeneral } from './fixtures.ts'
import { aggregateDailyFluidMl } from './nutritionAggregation.ts'
import { intervalDurationHours, resolveSleepDuration, type SleepInterval } from './sleepIntervals.ts'

const now = new Date('2026-11-15T12:00:00.000Z')

test('E02-domain: daily steps include sleep and nutrition; personal optional', () => {
  assert.deepEqual(checkinSteps(false, 'daily'), [
    'general',
    'sleep',
    'nutrition',
    'symptoms',
    'measurements',
    'review',
  ])
  assert.deepEqual(checkinSteps(true, 'daily'), [
    'general',
    'sleep',
    'nutrition',
    'symptoms',
    'personal',
    'measurements',
    'review',
  ])
})

test('E03 change path skips sleep and nutrition steps', () => {
  assert.deepEqual(checkinSteps(false, 'change'), ['general', 'symptoms', 'measurements', 'review'])
  assert.deepEqual(checkinSteps(true, 'change'), [
    'general',
    'symptoms',
    'personal',
    'measurements',
    'review',
  ])
})

test('sleep hours 0 stays answered zero, not a skip', () => {
  const values = readyDaily()
  values.sleepHours = '0'
  values.sleepSkip = false
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.issues.length, 0)
  assert.equal(built.payload?.sleep_hours, 0)
  assert.equal(built.payload?.sleep_answer_status, 'answered')
})

test('sleep skip stores null with unknown status', () => {
  const values = readyDaily()
  values.sleepHours = ''
  values.sleepSkip = true
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.issues.length, 0)
  assert.equal(built.payload?.sleep_hours, null)
  assert.equal(built.payload?.sleep_answer_status, 'unknown')
})

test('schema rejects zero marked as unknown and null marked as answered', () => {
  const zeroAsUnknown = generalPayloadSchema.safeParse({
    ...baseGeneral(),
    sleep_hours: 0,
    sleep_answer_status: 'unknown',
  })
  assert.equal(zeroAsUnknown.success, false)

  const nullAsAnswered = generalPayloadSchema.safeParse({
    ...baseGeneral(),
    sleep_hours: null,
    sleep_answer_status: 'answered',
  })
  assert.equal(nullAsAnswered.success, false)
})

test('E03 change event omits sleep without requiring skip flags', () => {
  const values = emptyCheckinDraft('change', '2026-11-15T11:00')
  values.overallState = 'fair'
  values.fatigueSkip = true
  values.stressSkip = true
  values.emotional = 'calm'
  values.symptomPresence = 'no'
  values.reviewRequested = false
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.issues.length, 0)
  assert.equal(built.payload?.sleep_hours, null)
  assert.equal(built.payload?.sleep_answer_status, 'not_applicable')
  assert.equal(built.payload?.nutrition.section_status, 'not_applicable')
})

test('E06 fluid not_tracked stays distinct from 0', () => {
  const values = readyDaily()
  values.nutritionFill = 'filled'
  values.appetiteSkip = true
  values.mealPlan = 'no_plan'
  values.mealPlanSkip = false
  values.fluidSkip = true
  values.fluidRaw = ''
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.issues.length, 0)
  assert.equal(built.payload?.nutrition.fluid_ml, null)
  assert.equal(built.payload?.nutrition.fluid_answer_status, 'unknown')

  values.fluidSkip = false
  values.fluidRaw = '0'
  values.fluidCompleteness = 'full'
  const zero = buildGeneralPayload(values, 'UTC', now)
  assert.equal(zero.issues.length, 0)
  assert.equal(zero.payload?.nutrition.fluid_ml, 0)
  assert.equal(zero.payload?.nutrition.fluid_answer_status, 'answered')
})

test('E07 partial fluid completeness is stored', () => {
  const values = readyDaily()
  values.nutritionFill = 'filled'
  values.appetiteSkip = true
  values.mealPlanSkip = true
  values.fluidRaw = '500'
  values.fluidSkip = false
  values.fluidCompleteness = 'partial'
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.issues.length, 0)
  assert.equal(built.payload?.nutrition.fluid_completeness, 'partial')
})

test('E08 meal plan no_plan does not invent completion percent', () => {
  const values = readyDaily()
  values.nutritionFill = 'filled'
  values.appetiteSkip = true
  values.mealPlan = 'no_plan'
  values.mealPlanSkip = false
  values.fluidSkip = true
  const built = buildGeneralPayload(values, 'UTC', now)
  assert.equal(built.payload?.nutrition.meal_plan, 'no_plan')
  assert.equal(built.payload?.nutrition.missed_meals, null)
  assert.equal(built.payload?.nutrition.missed_meals_answer_status, 'not_applicable')
})

test('skipped nutrition section is valid payload', () => {
  const skipped = skippedNutrition('skipped')
  const parsed = generalPayloadSchema.safeParse({ ...baseGeneral(), nutrition: skipped })
  assert.equal(parsed.success, true)
})

test('measurements step never blocks commit validation', () => {
  const values = readyDaily()
  assert.deepEqual(issuesForStep('measurements', values, 'UTC', now, false), [])
})

test('E04 sleep interval crossing midnight yields correct duration', () => {
  const hours = intervalDurationHours('2026-11-14T22:30:00.000Z', '2026-11-15T06:30:00.000Z')
  assert.equal(hours, 8)
  const overnight: SleepInterval = {
    start_at: '2026-11-14T23:00:00.000Z',
    end_at: '2026-11-15T05:00:00.000Z',
    kind: 'primary',
    quality: 'slept',
  }
  const resolved = resolveSleepDuration({ overallHours: null, intervals: [overnight] })
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  assert.equal(resolved.hours, 6)
  assert.equal(resolved.source, 'intervals')
})

test('E05 intervals + overall estimate do not double-sum; source chosen explicitly', () => {
  const intervals: SleepInterval[] = [
    {
      start_at: '2026-11-14T22:00:00.000Z',
      end_at: '2026-11-15T04:00:00.000Z',
      kind: 'primary',
      quality: 'slept',
    },
  ]
  const bothWithoutSource = resolveSleepDuration({ overallHours: 7.5, intervals })
  assert.equal(bothWithoutSource.ok, false)
  if (bothWithoutSource.ok) return
  assert.equal(bothWithoutSource.issue, 'source_required')

  const fromOverall = resolveSleepDuration({
    overallHours: 7.5,
    intervals,
    source: 'overall',
  })
  assert.equal(fromOverall.ok, true)
  if (!fromOverall.ok) return
  assert.equal(fromOverall.hours, 7.5)
  assert.notEqual(fromOverall.hours, 7.5 + 6)

  const fromIntervals = resolveSleepDuration({ overallHours: 7.5, intervals, source: 'intervals' })
  assert.equal(fromIntervals.ok, true)
  if (!fromIntervals.ok) return
  assert.equal(fromIntervals.hours, 6)

  const overlapping = resolveSleepDuration({
    overallHours: null,
    intervals: [
      {
        start_at: '2026-11-14T22:00:00.000Z',
        end_at: '2026-11-15T04:00:00.000Z',
        kind: 'primary',
        quality: 'slept',
      },
      {
        start_at: '2026-11-15T02:00:00.000Z',
        end_at: '2026-11-15T05:00:00.000Z',
        kind: 'additional',
        quality: 'slept',
      },
    ],
  })
  assert.equal(overlapping.ok, false)
  if (overlapping.ok) return
  assert.equal(overlapping.issue, 'overlap')
})

test('E38 overlapping nutrition windows do not double daily fluid totals', () => {
  const result = aggregateDailyFluidMl([
    {
      period_start: '2026-11-14T12:00:00.000Z',
      period_end: '2026-11-15T12:00:00.000Z',
      fluid_ml: 1500,
      fluid_answer_status: 'answered',
    },
    {
      period_start: '2026-11-15T00:00:00.000Z',
      period_end: '2026-11-16T00:00:00.000Z',
      fluid_ml: 800,
      fluid_answer_status: 'answered',
    },
  ])
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.overlapped, true)
  assert.equal(result.total_ml, 1500)
  assert.notEqual(result.total_ml, 1500 + 800)

  const disjoint = aggregateDailyFluidMl([
    {
      period_start: '2026-11-14T00:00:00.000Z',
      period_end: '2026-11-14T12:00:00.000Z',
      fluid_ml: 500,
      fluid_answer_status: 'answered',
    },
    {
      period_start: '2026-11-14T12:00:00.000Z',
      period_end: '2026-11-15T00:00:00.000Z',
      fluid_ml: 700,
      fluid_answer_status: 'answered',
    },
  ])
  assert.equal(disjoint.ok, true)
  if (!disjoint.ok) return
  assert.equal(disjoint.overlapped, false)
  assert.equal(disjoint.total_ml, 1200)
})

function readyDaily() {
  const values = emptyCheckinDraft('daily', '2026-11-15T11:00')
  values.overallState = 'fair'
  values.sleepHours = '7.5'
  values.sleepSkip = false
  values.sleepQualitySkip = true
  values.fatigue = 0
  values.fatigueSkip = false
  values.stressSkip = true
  values.emotional = 'calm'
  values.symptomPresence = 'no'
  values.reviewRequested = false
  values.nutritionFill = 'skipped'
  return values
}
