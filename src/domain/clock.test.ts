import assert from 'node:assert/strict'
import test from 'node:test'
import { dateToZonedInput, formatUtcClock, localDateInZone, missionDay, zonedInputToDate } from './clock.ts'

test('mission day counts UTC elapsed time and the days before launch', () => {
  const start = new Date('2026-01-01T00:00:00.000Z')
  assert.deepEqual(missionDay(start, new Date('2026-01-01T10:00:00.000Z')), { phase: 'in_mission', day: 1 })
  assert.deepEqual(missionDay(start, new Date('2026-01-02T00:00:00.000Z')), { phase: 'in_mission', day: 2 })
  assert.deepEqual(missionDay(start, new Date('2025-12-30T00:00:00.000Z')), { phase: 'before', days: 2 })
})

test('wall time converts to the correct UTC instant', () => {
  assert.equal(zonedInputToDate('2026-11-14T12:00', 'UTC')?.toISOString(), '2026-11-14T12:00:00.000Z')
  assert.equal(zonedInputToDate('2026-11-14T12:00', 'Asia/Almaty')?.toISOString(), '2026-11-14T07:00:00.000Z')
  assert.equal(dateToZonedInput(new Date('2026-11-14T07:00:00.000Z'), 'Asia/Almaty'), '2026-11-14T12:00')
  assert.equal(localDateInZone(new Date('2026-11-14T19:30:00.000Z'), 'Asia/Almaty'), '2026-11-15')
})

test('header clock shows the UTC wall time of the instant', () => {
  assert.equal(formatUtcClock(new Date('2026-11-14T09:05:07.000Z')), '09:05:07 UTC')
})
