import { zonedInputToDate } from './clock.ts'
import type { MeasurementContext, Metric } from './enums.ts'
import { measurementOperationSchema } from './operation.ts'
import {
  inputUnitForMetric,
  massDraftToKg,
  parseLooseNumber,
  temperatureDraftToCelsius,
  type UnitSystem,
} from './unitSystem.ts'

const BASE_UNITS = { heart_rate: 'bpm', temperature: 'celsius', spo2: 'percent', body_mass: 'kg' } as const

export type ManualMeasurementDraft = {
  metric: Metric | null
  rawValue: string
  recordedAtLocal: string
  context: MeasurementContext
  instrument: string
  note: string
}

export type ManualMeasurementIssue = { path: string; message: string }

export type InspectedMeasurement = ReturnType<typeof measurementOperationSchema.parse> & {
  input_value: number | null
  input_unit: 'bpm' | 'celsius' | 'fahrenheit' | 'percent' | 'kg' | 'lb' | null
}

export function inspectManualMeasurement(
  draft: ManualMeasurementDraft,
  identity: {
    id: string
    missionId: string
    deviceId: string
    timeZone: string
    now: Date
    demoDatasetId: string | null
    unitSystem: UnitSystem
  },
): { payload: InspectedMeasurement | null; issues: ManualMeasurementIssue[] } {
  const issues: ManualMeasurementIssue[] = []
  if (draft.metric === null) issues.push({ path: 'metric', message: 'required' })
  const recorded = zonedInputToDate(draft.recordedAtLocal, identity.timeZone)
  if (recorded === null) issues.push({ path: 'recordedAtLocal', message: 'required' })
  else if (recorded.getTime() > identity.now.getTime() + 5 * 60 * 1000) {
    issues.push({ path: 'recordedAtLocal', message: 'future_limit' })
  }
  if (draft.instrument.trim().length > 100) issues.push({ path: 'instrument', message: 'too_long' })
  if (draft.note.trim().length > 300) issues.push({ path: 'note', message: 'too_long' })
  if (draft.metric === null || recorded === null || issues.length > 0) return { payload: null, issues }

  const inputNumeric = parseLooseNumber(draft.rawValue)
  if (inputNumeric === null) {
    return { payload: null, issues: [{ path: 'rawValue', message: 'invalid' }] }
  }

  let baseValue = inputNumeric
  if (draft.metric === 'temperature') {
    const celsius = temperatureDraftToCelsius(draft.rawValue, identity.unitSystem)
    if (celsius === null) return { payload: null, issues: [{ path: 'rawValue', message: 'invalid' }] }
    // Quantize to 0.1 °C for storage without chaining display rounding.
    baseValue = Math.round(celsius * 10) / 10
  }
  if (draft.metric === 'body_mass') {
    const kg = massDraftToKg(draft.rawValue, identity.unitSystem)
    if (kg === null) return { payload: null, issues: [{ path: 'rawValue', message: 'invalid' }] }
    baseValue = Math.round(kg * 10) / 10
  }

  const inputUnit = inputUnitForMetric(draft.metric, identity.unitSystem)
  const metadata: Record<string, unknown> = {
    input_value: inputNumeric,
    input_unit: inputUnit,
  }
  if (draft.instrument.trim() !== '') metadata.instrument = draft.instrument.trim()

  const payload = {
    id: identity.id,
    mission_id: identity.missionId,
    metric: draft.metric,
    value: baseValue,
    unit: BASE_UNITS[draft.metric],
    source: 'manual' as const,
    quality: 'unknown' as const,
    quality_reasons: [] as string[],
    context: draft.context,
    note: draft.note.trim() === '' ? null : draft.note.trim(),
    device_metadata: metadata,
    algorithm_version: null,
    attempt_id: null,
    device_id: identity.deviceId,
    recorded_at: recorded.toISOString(),
    created_at_device: identity.now.toISOString(),
    demo_dataset_id: identity.demoDatasetId,
  }
  const parsed = measurementOperationSchema.safeParse(payload)
  if (!parsed.success) {
    const message = parsed.error.issues.some((issue) => issue.message === 'value_out_of_range')
      ? 'value_out_of_range'
      : 'invalid'
    return { payload: null, issues: [{ path: 'rawValue', message }] }
  }
  return {
    payload: {
      ...parsed.data,
      input_value: inputNumeric,
      input_unit: inputUnit,
    },
    issues: [],
  }
}
