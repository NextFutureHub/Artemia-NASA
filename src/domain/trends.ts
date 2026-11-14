export type TrendMetric = 'sleep' | 'fatigue' | 'heart_rate'
export type TrendSource = 'manual' | 'usb' | 'simulated'
export type TrendQuality = 'unknown' | 'valid' | 'invalid' | 'insufficient'

export type TrendPoint = {
  at: string
  date: string
  value: number | null
  source: TrendSource
  quality: TrendQuality
  href: string
  plotted: boolean
  gapBefore: boolean
}

export type TrendComparison =
  | { status: 'insufficient' }
  | { status: 'compared'; latest: number; median: number; observations: number; days: number; source: TrendSource }

export type TrendSeries = {
  metric: TrendMetric
  unit: 'hours' | 'score' | 'bpm'
  yMin: number
  yMax: number
  points: TrendPoint[]
  comparison: TrendComparison
}

export type SleepInput = {
  date: string
  recordedAt: string
  hours: number | null
  status: string
  invalidated: boolean
  type: 'daily' | 'change'
  href: string
}

export type ScoreInput = {
  date: string
  recordedAt: string
  score: number | null
  status: string
  invalidated: boolean
  href: string
}

export type PulseInput = {
  recordedAt: string
  date: string
  value: number | null
  source: TrendSource
  quality: TrendQuality
  context: string | null
  href: string
}

const SCALES = {
  sleep: { unit: 'hours', yMin: 0, yMax: 24 },
  fatigue: { unit: 'score', yMin: 0, yMax: 10 },
  heart_rate: { unit: 'bpm', yMin: 20, yMax: 250 },
} as const

export function sleepSeries(rows: SleepInput[]): TrendSeries {
  const daily = rows
    .filter((row) => !row.invalidated && row.type === 'daily' && row.status === 'answered' && row.hours !== null)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
  const byDate = new Map<string, SleepInput>()
  for (const row of daily) byDate.set(row.date, row)
  const points = markGaps(
    [...byDate.values()]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((row) => point(row.recordedAt, row.date, row.hours, 'manual', 'valid', row.href, true)),
  )
  return series('sleep', points, points)
}

export function fatigueSeries(rows: ScoreInput[]): TrendSeries {
  const answered = rows
    .filter((row) => !row.invalidated && row.status === 'answered' && row.score !== null)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
  const byDate = new Map<string, ScoreInput>()
  for (const row of answered) byDate.set(row.date, row)
  const points = markGaps(
    [...byDate.values()]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((row) => point(row.recordedAt, row.date, row.score, 'manual', 'valid', row.href, true)),
  )
  return series('fatigue', points, points)
}

export function pulseSeries(rows: PulseInput[]): TrendSeries {
  const ordered = [...rows].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
  const points = markGaps(
    ordered.map((row) => {
      const usable = row.value !== null && row.quality !== 'invalid' && row.quality !== 'insufficient'
      return point(row.recordedAt, row.date, row.value, row.source, row.quality, row.href, usable)
    }),
  )
  const comparable = ordered.filter(
    (row) => row.value !== null && row.quality !== 'invalid' && row.quality !== 'insufficient' && row.source !== 'simulated' && row.context === 'rest',
  )
  return series('heart_rate', points, comparable.map((row) => point(row.recordedAt, row.date, row.value, row.source, row.quality, row.href, true)))
}

export function comparisonText(locale: 'ru' | 'en', comparison: TrendComparison): string {
  if (comparison.status === 'insufficient') {
    return locale === 'ru' ? 'Недостаточно истории для сравнения' : 'Not enough history for a comparison'
  }
  const latest = formatNumber(comparison.latest)
  const median = formatNumber(comparison.median)
  return locale === 'ru'
    ? `Последнее значение ${latest}. Личная медиана ${median}.`
    : `Latest value ${latest}. Personal median ${median}.`
}

export function lineSegments(points: TrendPoint[]): TrendPoint[][] {
  const groups: TrendPoint[][] = []
  for (const item of points) {
    if (!item.plotted || item.value === null) continue
    const group = groups.at(-1)
    const previous = group?.at(-1)
    if (!group || !previous || item.gapBefore || item.source !== previous.source) groups.push([item])
    else group.push(item)
  }
  return groups
}

function series(metric: TrendMetric, points: TrendPoint[], comparable: TrendPoint[]): TrendSeries {
  const scale = SCALES[metric]
  return {
    metric,
    unit: scale.unit,
    yMin: scale.yMin,
    yMax: scale.yMax,
    points,
    comparison: compare(comparable),
  }
}

function compare(points: TrendPoint[]): TrendComparison {
  const plotted = points.filter((item) => item.plotted && item.value !== null && item.source !== 'simulated')
  const latest = plotted.at(-1)
  if (!latest || latest.value === null) return { status: 'insufficient' }
  const start = shiftDate(latest.date, -7)
  const earlier = plotted.filter((item) => item.date >= start && item.date < latest.date && item.source === latest.source)
  const days = new Set(earlier.map((item) => item.date))
  if (earlier.length < 5 || days.size < 3) return { status: 'insufficient' }
  return {
    status: 'compared',
    latest: latest.value,
    median: median(earlier.map((item) => item.value as number)),
    observations: earlier.length,
    days: days.size,
    source: latest.source,
  }
}

function markGaps(points: TrendPoint[]): TrendPoint[] {
  let previous: string | null = null
  return points.map((item) => {
    const gapBefore = previous !== null && item.plotted && daysBetween(previous, item.date) > 1
    if (item.plotted) previous = item.date
    return { ...item, gapBefore }
  })
}

function point(
  at: string,
  date: string,
  value: number | null,
  source: TrendSource,
  quality: TrendQuality,
  href: string,
  plotted: boolean,
): TrendPoint {
  return { at, date, value, source, quality, href, plotted, gapBefore: false }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function shiftDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetween(start: string, end: string): number {
  const [startYear, startMonth, startDay] = start.split('-').map(Number)
  const [endYear, endMonth, endDay] = end.split('-').map(Number)
  const from = Date.UTC(startYear ?? 2026, (startMonth ?? 1) - 1, startDay ?? 1)
  const to = Date.UTC(endYear ?? 2026, (endMonth ?? 1) - 1, endDay ?? 1)
  return Math.round((to - from) / 86_400_000)
}
