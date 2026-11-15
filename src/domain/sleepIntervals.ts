/**
 * EXT-1 sleep interval helpers: midnight crossing, overlap, dual-source (E04/E05).
 * Overall estimate and intervals are alternative sources — never auto-added.
 */

import {
  SLEEP_INTERVAL_KINDS,
  SLEEP_INTERVAL_QUALITIES,
  type AnswerStatus,
  type SleepDurationSource,
  type SleepIntervalKind,
  type SleepIntervalQuality,
} from './enums.ts'

export type { SleepDurationSource, SleepIntervalKind, SleepIntervalQuality }

export type SleepInterval = {
  start_at: string
  end_at: string
  kind: SleepIntervalKind
  quality: SleepIntervalQuality
}

export type SleepIntervalIssue = { path: string; message: string }

export type ResolveSleepDurationInput = {
  overallHours: number | null
  intervals: SleepInterval[]
  /** Required when both overall and intervals are usable. */
  source?: SleepDurationSource | null
}

export type ResolveSleepDurationResult =
  | { ok: true; hours: number; source: SleepDurationSource }
  | {
      ok: false
      issue: 'empty' | 'overlap' | 'duplicate' | 'order' | 'source_required' | 'source_mismatch'
    }

const MS_PER_HOUR = 3_600_000

/** Duration in hours; midnight crossing is valid when end > start in absolute time. */
export function intervalDurationHours(startAt: string, endAt: string): number | null {
  const start = Date.parse(startAt)
  const end = Date.parse(endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return (end - start) / MS_PER_HOUR
}

export function intervalsOverlap(a: SleepInterval, b: SleepInterval): boolean {
  const a0 = Date.parse(a.start_at)
  const a1 = Date.parse(a.end_at)
  const b0 = Date.parse(b.start_at)
  const b1 = Date.parse(b.end_at)
  if (![a0, a1, b0, b1].every(Number.isFinite)) return false
  return a0 < b1 && b0 < a1
}

function intervalKey(interval: SleepInterval): string {
  return `${interval.start_at}|${interval.end_at}|${interval.kind}|${interval.quality}`
}

export function findDuplicateIntervals(intervals: SleepInterval[]): boolean {
  const seen = new Set<string>()
  for (const interval of intervals) {
    const key = intervalKey(interval)
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

export function findOverlappingIntervals(intervals: SleepInterval[]): boolean {
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      const left = intervals[i]
      const right = intervals[j]
      if (left && right && intervalsOverlap(left, right)) return true
    }
  }
  return false
}

/** Sum only slept intervals; in_bed does not count as confirmed sleep. */
export function sumSleptIntervalHours(intervals: SleepInterval[]): number | null {
  if (intervals.length === 0) return null
  if (findDuplicateIntervals(intervals) || findOverlappingIntervals(intervals)) return null
  let total = 0
  for (const interval of intervals) {
    if (interval.quality !== 'slept') continue
    const hours = intervalDurationHours(interval.start_at, interval.end_at)
    if (hours === null) return null
    total += hours
  }
  return total
}

export function hasUsableOverall(sleepHours: number | null, sleepAnswerStatus: AnswerStatus): boolean {
  return sleepAnswerStatus === 'answered' && sleepHours !== null && Number.isFinite(sleepHours)
}

export function hasUsableIntervals(intervals: SleepInterval[]): boolean {
  if (intervals.length === 0) return false
  if (validateSleepIntervalList(intervals).length > 0) return false
  return sumSleptIntervalHours(intervals) !== null
}

/**
 * Validate interval list: order, kinds, no duplicates, no overlaps.
 * Overlaps require correction — they are never summed twice.
 */
export function validateSleepIntervalList(intervals: SleepInterval[]): SleepIntervalIssue[] {
  const issues: SleepIntervalIssue[] = []
  const seen = new Set<string>()

  for (let i = 0; i < intervals.length; i += 1) {
    const item = intervals[i]
    if (!item) continue
    if (!(SLEEP_INTERVAL_KINDS as readonly string[]).includes(item.kind)) {
      issues.push({ path: `sleep_intervals.${i}.kind`, message: 'invalid' })
    }
    if (!(SLEEP_INTERVAL_QUALITIES as readonly string[]).includes(item.quality)) {
      issues.push({ path: `sleep_intervals.${i}.quality`, message: 'invalid' })
    }
    if (intervalDurationHours(item.start_at, item.end_at) === null) {
      issues.push({ path: `sleep_intervals.${i}.end_at`, message: 'period_order' })
    }
    const key = intervalKey(item)
    if (seen.has(key)) {
      issues.push({ path: `sleep_intervals.${i}`, message: 'duplicate' })
    }
    seen.add(key)
  }

  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      const left = intervals[i]
      const right = intervals[j]
      if (left && right && intervalsOverlap(left, right) && intervalKey(left) !== intervalKey(right)) {
        issues.push({ path: `sleep_intervals.${j}`, message: 'overlap' })
      }
    }
  }

  return issues
}

/**
 * Resolve reported sleep hours from overall estimate and/or detailed intervals.
 * Never adds overall + interval sum. When both exist, caller must pick a source.
 */
export function resolveSleepDuration(input: ResolveSleepDurationInput): ResolveSleepDurationResult {
  const overallOk = input.overallHours !== null && Number.isFinite(input.overallHours)
  const listIssues = input.intervals.length > 0 ? validateSleepIntervalList(input.intervals) : []
  if (listIssues.some((item) => item.message === 'period_order')) return { ok: false, issue: 'order' }
  if (listIssues.some((item) => item.message === 'duplicate')) return { ok: false, issue: 'duplicate' }
  if (listIssues.some((item) => item.message === 'overlap')) return { ok: false, issue: 'overlap' }

  const intervalsOk = hasUsableIntervals(input.intervals)

  if (!overallOk && !intervalsOk) return { ok: false, issue: 'empty' }

  if (overallOk && intervalsOk) {
    if (input.source !== 'overall' && input.source !== 'intervals') {
      return { ok: false, issue: 'source_required' }
    }
    if (input.source === 'overall') {
      return { ok: true, hours: input.overallHours as number, source: 'overall' }
    }
    const summed = sumSleptIntervalHours(input.intervals)
    if (summed === null) return { ok: false, issue: 'order' }
    return { ok: true, hours: summed, source: 'intervals' }
  }

  if (overallOk) {
    if (input.source === 'intervals') return { ok: false, issue: 'source_mismatch' }
    return { ok: true, hours: input.overallHours as number, source: 'overall' }
  }

  if (input.source === 'overall') return { ok: false, issue: 'source_mismatch' }
  const summed = sumSleptIntervalHours(input.intervals)
  if (summed === null) return { ok: false, issue: 'order' }
  return { ok: true, hours: summed, source: 'intervals' }
}
