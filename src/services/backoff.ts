const STEPS_MS = [2_000, 5_000, 15_000, 30_000, 60_000]

export function retryDelayMs(attempts: number, random: number): number {
  const index = Math.min(Math.max(attempts, 1), STEPS_MS.length) - 1
  const base = STEPS_MS[index] ?? 60_000
  const unit = Math.min(1, Math.max(0, random))
  const jitter = 1 + (unit * 2 - 1) * 0.2
  return Math.round(base * jitter)
}
