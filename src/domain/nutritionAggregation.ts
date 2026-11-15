/**
 * Aggregate reported fluid across nutrition periods without double-counting
 * overlapping windows (E38).
 *
 * Overlapping windows form clusters; each cluster contributes max(fluid_ml),
 * never the sum of overlapping reports.
 */

export type NutritionFluidWindow = {
  period_start: string
  period_end: string
  fluid_ml: number | null
  fluid_answer_status: string
}

export type AggregateFluidResult =
  | { ok: true; total_ml: number; overlapped: boolean }
  | { ok: false; issue: 'period_order' | 'invalid_fluid' }

export function aggregateDailyFluidMl(windows: NutritionFluidWindow[]): AggregateFluidResult {
  const answered: NutritionFluidWindow[] = []
  for (const window of windows) {
    const start = Date.parse(window.period_start)
    const end = Date.parse(window.period_end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      return { ok: false, issue: 'period_order' }
    }
    if (window.fluid_answer_status === 'answered') {
      if (window.fluid_ml === null || !Number.isFinite(window.fluid_ml) || window.fluid_ml < 0) {
        return { ok: false, issue: 'invalid_fluid' }
      }
      answered.push(window)
    }
  }

  if (answered.length === 0) {
    return { ok: true, total_ml: 0, overlapped: false }
  }

  const parent = answered.map((_, index) => index)
  const find = (i: number): number => {
    let cursor = i
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]!]!
      cursor = parent[cursor]!
    }
    return cursor
  }
  const union = (i: number, j: number) => {
    const a = find(i)
    const b = find(j)
    if (a !== b) parent[b] = a
  }

  let overlapped = false
  for (let i = 0; i < answered.length; i += 1) {
    for (let j = i + 1; j < answered.length; j += 1) {
      const left = answered[i]!
      const right = answered[j]!
      const a0 = Date.parse(left.period_start)
      const a1 = Date.parse(left.period_end)
      const b0 = Date.parse(right.period_start)
      const b1 = Date.parse(right.period_end)
      if (a0 < b1 && b0 < a1) {
        overlapped = true
        union(i, j)
      }
    }
  }

  const clusters = new Map<number, number>()
  for (let i = 0; i < answered.length; i += 1) {
    const root = find(i)
    const value = answered[i]!.fluid_ml as number
    const prior = clusters.get(root)
    clusters.set(root, prior === undefined ? value : Math.max(prior, value))
  }

  let total = 0
  for (const value of clusters.values()) total += value
  return { ok: true, total_ml: total, overlapped }
}

/** Alias used by some call sites. */
export const aggregateFluidWithoutDoubleCount = aggregateDailyFluidMl
