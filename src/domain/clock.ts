/** Mission clock. Stored instants stay UTC. The mission day uses the start instant, not a local calendar. */

const DAY_MS = 86_400_000

export type MissionDay =
  | { phase: 'before'; days: number }
  | { phase: 'in_mission'; day: number }

export function missionDay(start: Date, now: Date): MissionDay {
  const delta = now.getTime() - start.getTime()
  if (delta < 0) {
    return { phase: 'before', days: Math.max(1, Math.ceil(-delta / DAY_MS)) }
  }
  return { phase: 'in_mission', day: Math.floor(delta / DAY_MS) + 1 }
}

export function zonedInputToDate(localValue: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0)
  const adjusted = wall - zoneOffsetMs(wall, timeZone)
  return new Date(wall - zoneOffsetMs(adjusted, timeZone))
}

export function dateToZonedInput(value: Date, timeZone: string): string {
  const parts = zoneParts(value, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function localDateInZone(value: Date, timeZone: string): string {
  const parts = zoneParts(value, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function formatZoned(value: Date, timeZone: string, locale: string): string {
  const formatted = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value)
  return `${formatted} ${timeZone}`
}

/** Wall-clock UTC for the mission header. Uses the instant, not a mission-local calendar. */
export function formatUtcClock(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, '0')
  const minutes = String(value.getUTCMinutes()).padStart(2, '0')
  const seconds = String(value.getUTCSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds} UTC`
}

/** Compact UTC clock for assessment headers (HH:MM UTC). */
export function formatUtcHm(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, '0')
  const minutes = String(value.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes} UTC`
}

function zoneParts(value: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(value)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  if (map.hour === '24') map.hour = '00'
  return map
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = zoneParts(new Date(utcMs), timeZone)
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - utcMs
}
