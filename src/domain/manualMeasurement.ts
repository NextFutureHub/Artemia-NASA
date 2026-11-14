import { zonedInputToDate } from './clock.ts'
import type { MeasurementContext, Metric } from './enums.ts'
import { measurementOperationSchema } from './operation.ts'

const UNITS = { heart_rate: 'bpm', temperature: 'celsius', spo2: 'percent' } as const

export type ManualMeasurementDraft = {
  metric: Metric | null
  rawValue: string
  recordedAtLocal: string
  context: MeasurementContext
  instrument: string
  note: string
}

export type ManualMeasurementIssue = { path: string; message: string }

export function inspectManualMeasurement(
  draft: ManualMeasurementDraft,
  identity: {
    id: string
    missionId: string
    deviceId: string
    timeZone: string
    now: Date
    demoDatasetId: string | null
  },
): { payload: ReturnType<typeof measurementOperationSchema.parse> | null; issues: ManualMeasurementIssue[] } {
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

  const numeric = Number(draft.rawValue)
  const payload = {
    id: identity.id,
    mission_id: identity.missionId,
    metric: draft.metric,
    value: numeric,
    unit: UNITS[draft.metric],
    source: 'manual' as const,
    quality: 'unknown' as const,
    quality_reasons: [] as string[],
    context: draft.context,
    note: draft.note.trim() === '' ? null : draft.note.trim(),
    device_metadata: draft.instrument.trim() === '' ? null : { instrument: draft.instrument.trim() },
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
  return { payload: parsed.data, issues: [] }
}
