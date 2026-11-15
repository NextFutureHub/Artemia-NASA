/** Canonical preference: metric (EU) or us. Storage/API always use base units °C, cm, kg. */

export const UNIT_SYSTEMS = ['metric', 'us'] as const
export type UnitSystem = (typeof UNIT_SYSTEMS)[number]

export const KG_PER_LB = 0.45359237
export const CM_PER_INCH = 2.54
export const INCHES_PER_FOOT = 12

export type DisplayUnit =
  | 'celsius'
  | 'fahrenheit'
  | 'cm'
  | 'ft_in'
  | 'kg'
  | 'lb'
  | 'bpm'
  | 'percent'
  | 'mmhg'

export function isUnitSystem(value: unknown): value is UnitSystem {
  return value === 'metric' || value === 'us'
}

export function normalizeUnitSystem(value: unknown): UnitSystem {
  return isUnitSystem(value) ? value : 'metric'
}

/** Exact base conversions — no display rounding. */
export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB
}

export function cmToTotalInches(cm: number): number {
  return cm / CM_PER_INCH
}

export function totalInchesToCm(inches: number): number {
  return inches * CM_PER_INCH
}

export function feetInchesToCm(feet: number, inches: number): number {
  return totalInchesToCm(feet * INCHES_PER_FOOT + inches)
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const total = cmToTotalInches(cm)
  let feet = Math.floor(total / INCHES_PER_FOOT)
  let inches = round1(total - feet * INCHES_PER_FOOT)
  if (inches >= INCHES_PER_FOOT - 1e-9) {
    feet += 1
    inches = 0
  }
  return { feet, inches }
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function formatOneDecimal(value: number): string {
  const rounded = round1(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function temperatureDisplayUnit(system: UnitSystem): DisplayUnit {
  return system === 'us' ? 'fahrenheit' : 'celsius'
}

export function massDisplayUnit(system: UnitSystem): DisplayUnit {
  return system === 'us' ? 'lb' : 'kg'
}

export function heightDisplayUnit(system: UnitSystem): DisplayUnit {
  return system === 'us' ? 'ft_in' : 'cm'
}

/** Format a base (°C) temperature for the viewer's unit system. Null stays empty. */
export function formatTemperatureFromCelsius(celsius: number | null, system: UnitSystem): string {
  if (celsius === null || !Number.isFinite(celsius)) return ''
  if (system === 'us') return formatOneDecimal(celsiusToFahrenheit(celsius))
  return formatOneDecimal(celsius)
}

export function formatMassFromKg(kg: number | null, system: UnitSystem): string {
  if (kg === null || !Number.isFinite(kg)) return ''
  if (system === 'us') return formatOneDecimal(kgToLb(kg))
  return formatOneDecimal(kg)
}

export function formatHeightFromCm(cm: number | null, system: UnitSystem): string {
  if (cm === null || !Number.isFinite(cm)) return ''
  if (system === 'metric') return formatOneDecimal(cm)
  const { feet, inches } = cmToFeetInches(cm)
  return `${feet}' ${formatOneDecimal(inches)}"`
}

export function parseLooseNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.')
  if (trimmed === '') return null
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

export type DraftFieldKind = 'temperature' | 'mass' | 'height' | 'heart_rate' | 'spo2' | 'blood_pressure'

/**
 * Empty fields may switch freely. Incomplete/invalid non-empty input blocks the switch.
 * Valid values are converted from the previous system into the next system's display string.
 */
export function switchDraftField(
  kind: DraftFieldKind,
  raw: string,
  from: UnitSystem,
  to: UnitSystem,
): { ok: true; next: string } | { ok: false; reason: 'incomplete' } {
  if (from === to) return { ok: true, next: raw }
  if (raw.trim() === '') return { ok: true, next: '' }

  if (kind === 'heart_rate' || kind === 'spo2' || kind === 'blood_pressure') {
    const value = parseLooseNumber(raw)
    if (value === null) return { ok: false, reason: 'incomplete' }
    return { ok: true, next: raw.trim() }
  }

  if (kind === 'height' && from === 'us') {
    const parsed = parseFeetInches(raw)
    if (!parsed) return { ok: false, reason: 'incomplete' }
    const cm = feetInchesToCm(parsed.feet, parsed.inches)
    return { ok: true, next: formatHeightFromCm(cm, to) }
  }

  const value = parseLooseNumber(raw)
  if (value === null) return { ok: false, reason: 'incomplete' }

  if (kind === 'temperature') {
    const celsius = from === 'us' ? fahrenheitToCelsius(value) : value
    return { ok: true, next: formatTemperatureFromCelsius(celsius, to) }
  }
  if (kind === 'mass') {
    const kg = from === 'us' ? lbToKg(value) : value
    return { ok: true, next: formatMassFromKg(kg, to) }
  }
  if (kind === 'height') {
    return { ok: true, next: formatHeightFromCm(value, to) }
  }
  return { ok: true, next: raw }
}

/** Accepts "5' 10.5\"", "5'10\"", "5 ft 10 in", or a single inch total. */
export function parseFeetInches(raw: string): { feet: number; inches: number } | null {
  const text = raw.trim().toLowerCase().replace(',', '.')
  const classic = text.match(/^(\d+)\s*['′]\s*(\d+(?:\.\d+)?)\s*(?:["″]|in|inch|inches)?$/)
  if (classic) {
    return { feet: Number(classic[1]), inches: Number(classic[2]) }
  }
  const words = text.match(/^(\d+)\s*(?:ft|feet)\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches)?$/)
  if (words) {
    return { feet: Number(words[1]), inches: Number(words[2]) }
  }
  return null
}

/** Convert a temperature draft in the active system into base °C for validation/storage. */
export function temperatureDraftToCelsius(raw: string, system: UnitSystem): number | null {
  const value = parseLooseNumber(raw)
  if (value === null) return null
  return system === 'us' ? fahrenheitToCelsius(value) : value
}

export function massDraftToKg(raw: string, system: UnitSystem): number | null {
  const value = parseLooseNumber(raw)
  if (value === null) return null
  return system === 'us' ? lbToKg(value) : value
}

export function heightDraftToCm(raw: string, system: UnitSystem): number | null {
  if (system === 'us') {
    const parsed = parseFeetInches(raw)
    if (!parsed) return null
    return feetInchesToCm(parsed.feet, parsed.inches)
  }
  return parseLooseNumber(raw)
}

export function displayUnitLabel(
  locale: 'ru' | 'en',
  unit: DisplayUnit,
): string {
  if (unit === 'celsius') return '°C'
  if (unit === 'fahrenheit') return '°F'
  if (unit === 'cm') return locale === 'ru' ? 'см' : 'cm'
  if (unit === 'ft_in') return locale === 'ru' ? 'фт + дюйм' : 'ft + in'
  if (unit === 'kg') return 'kg'
  if (unit === 'lb') return 'lb'
  if (unit === 'bpm') return locale === 'ru' ? 'уд/мин' : 'bpm'
  if (unit === 'percent') return '%'
  return locale === 'ru' ? 'мм рт. ст.' : 'mmHg'
}

export function metricDisplayUnit(
  metric: 'heart_rate' | 'temperature' | 'spo2',
  system: UnitSystem,
): DisplayUnit {
  if (metric === 'temperature') return temperatureDisplayUnit(system)
  if (metric === 'spo2') return 'percent'
  return 'bpm'
}

/** Format stored base measurement for UI. Temperature base is always °C. */
export function formatStoredMeasurement(
  metric: 'heart_rate' | 'temperature' | 'spo2',
  value: number | null,
  system: UnitSystem,
): string {
  if (value === null) return ''
  if (metric === 'temperature') return formatTemperatureFromCelsius(value, system)
  if (metric === 'heart_rate' || metric === 'spo2') return String(Math.round(value))
  return String(value)
}

export function inputUnitForMetric(
  metric: 'heart_rate' | 'temperature' | 'spo2',
  system: UnitSystem,
): 'bpm' | 'celsius' | 'fahrenheit' | 'percent' {
  if (metric === 'temperature') return system === 'us' ? 'fahrenheit' : 'celsius'
  if (metric === 'spo2') return 'percent'
  return 'bpm'
}
