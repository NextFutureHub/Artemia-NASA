import { z } from 'zod'
import {
  CHECKIN_TYPES,
  CONSENT_DECISIONS,
  CONSENT_SCOPES,
  INVALIDATION_TARGETS,
  MEASUREMENT_CONTEXTS,
  MEASUREMENT_QUALITIES,
  MEASUREMENT_SOURCES,
  METRICS,
  OPERATION_TYPES,
  REPORT_REASONS,
  SHARING_MODES,
} from './enums.ts'
import { careOrderResponsePayloadSchema } from './careOrder.ts'
import { generalPayloadSchema } from './generalPayload.ts'
import { personalPayloadSchema } from './personalPayload.ts'
import { SCHEMA_VERSION } from './schemaVersion.ts'

const uuidSchema = z.uuid()
const timestampSchema = z.iso.datetime({ offset: true })
const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
const timezoneSchema = z.string().regex(/^[A-Za-z0-9_+./-]{1,64}$/)

export const checkinBundleSchema = z
  .strictObject({
    checkin: z
      .strictObject({
        id: uuidSchema,
        mission_id: uuidSchema,
        local_date: z.iso.date(),
        timezone: timezoneSchema,
        type: z.enum(CHECKIN_TYPES),
        root_id: uuidSchema,
        device_id: deviceIdSchema,
        recorded_at: timestampSchema,
        created_at_device: timestampSchema,
        source: z.enum(MEASUREMENT_SOURCES),
        demo_dataset_id: uuidSchema.nullable(),
      })
      ,
    revision: z
      .strictObject({
        id: uuidSchema,
        parent_revision_id: uuidSchema.nullable(),
        revision_no: z.number().int().min(1).max(1000),
        general_payload: generalPayloadSchema,
        reason: z.string().min(1).max(300).nullable(),
      })
      .superRefine((revision, ctx) => {
        if (revision.revision_no === 1) {
          if (revision.parent_revision_id !== null) {
            ctx.addIssue({ code: 'custom', path: ['parent_revision_id'], message: 'first_revision_has_no_parent' })
          }
          if (revision.reason !== null) {
            ctx.addIssue({ code: 'custom', path: ['reason'], message: 'first_revision_has_no_reason' })
          }
        } else if (revision.parent_revision_id === null || revision.reason === null) {
          ctx.addIssue({ code: 'custom', path: ['reason'], message: 'correction_requires_reason' })
        }
      }),
    personal: z
      .strictObject({
        id: uuidSchema,
        personal_payload: personalPayloadSchema,
        consent_event_id: uuidSchema,
      })
      .nullable(),
    measurement_ids: z.array(uuidSchema).max(50),
  })
  .superRefine((bundle, ctx) => {
    if (bundle.revision.revision_no === 1 && bundle.checkin.root_id !== bundle.checkin.id) {
      ctx.addIssue({ code: 'custom', path: ['checkin', 'root_id'], message: 'root_id_mismatch' })
    }
    if (new Set(bundle.measurement_ids).size !== bundle.measurement_ids.length) {
      ctx.addIssue({ code: 'custom', path: ['measurement_ids'], message: 'duplicate_measurement' })
    }
  })

const measurementValueSchema = z
  .strictObject({
    id: uuidSchema,
    mission_id: uuidSchema,
    metric: z.enum(METRICS),
    value: z.number().nullable(),
    unit: z.enum(['bpm', 'celsius', 'percent']),
    source: z.enum(MEASUREMENT_SOURCES),
    quality: z.enum(MEASUREMENT_QUALITIES),
    quality_reasons: z.array(z.string().min(1).max(80)).max(20),
    context: z.enum(MEASUREMENT_CONTEXTS).nullable(),
    note: z.string().min(1).max(300).nullable(),
    device_metadata: z.record(z.string(), z.unknown()).nullable(),
    algorithm_version: z.string().min(1).max(40).nullable(),
    attempt_id: uuidSchema.nullable(),
    device_id: deviceIdSchema,
    recorded_at: timestampSchema,
    created_at_device: timestampSchema,
    demo_dataset_id: uuidSchema.nullable(),
  })
  .superRefine((measurement, ctx) => {
    const valueRequired = measurement.quality === 'unknown' || measurement.quality === 'valid'
    if (!valueRequired && measurement.value !== null) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'invalid_measurement_value_must_be_null' })
    }
    if (valueRequired && measurement.value === null) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'value_required' })
    }
    if (measurement.value === null) return
    if (measurement.metric === 'heart_rate' && measurement.unit !== 'bpm') {
      ctx.addIssue({ code: 'custom', path: ['unit'], message: 'unit_mismatch' })
    }
    if (measurement.metric === 'temperature' && measurement.unit !== 'celsius') {
      ctx.addIssue({ code: 'custom', path: ['unit'], message: 'unit_mismatch' })
    }
    if (measurement.metric === 'spo2' && measurement.unit !== 'percent') {
      ctx.addIssue({ code: 'custom', path: ['unit'], message: 'unit_mismatch' })
    }
    if (measurement.metric === 'heart_rate' && !integerInRange(measurement.value, 20, 250)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'value_out_of_range' })
    }
    if (measurement.metric === 'spo2' && !integerInRange(measurement.value, 50, 100)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'value_out_of_range' })
    }
    if (measurement.metric === 'temperature') {
      const scaled = measurement.value * 10
      if (measurement.value < 30 || measurement.value > 45 || Math.abs(scaled - Math.round(scaled)) > 1e-6) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'value_out_of_range' })
      }
    }
  })

const snapshotMeasurementSchema = z.strictObject({
  measurement_id: uuidSchema,
  metric: z.enum(METRICS),
  value: z.number().nullable(),
  unit: z.enum(['bpm', 'celsius', 'percent']),
  source: z.enum(MEASUREMENT_SOURCES),
  quality: z.enum(MEASUREMENT_QUALITIES),
  recorded_at: timestampSchema,
})

export const reportSnapshotSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  revision_ids: z.array(uuidSchema).max(100),
  measurements: z.array(snapshotMeasurementSchema).max(100),
  explanatory_rule_versions: z
    .array(
      z.strictObject({
        rule_id: z.string().min(1).max(80),
        version: z.string().min(1).max(40),
      }),
    )
    .max(20),
  prepared_at: timestampSchema,
  message: z.string().min(1).max(2000).nullable(),
  recipient_assignment_id: uuidSchema,
  summary: z.string().min(1).max(2000),
})

export const reportBundleSchema = z
  .strictObject({
    report: z.strictObject({
      id: uuidSchema,
      mission_id: uuidSchema,
      recipient_assignment_id: uuidSchema,
      title: z.string().min(1).max(120),
      range_start: z.iso.date(),
      range_end: z.iso.date(),
      reason: z.enum(REPORT_REASONS),
      general_snapshot: reportSnapshotSchema,
      message: z.string().min(1).max(2000).nullable(),
      parent_report_id: uuidSchema.nullable(),
      device_id: deviceIdSchema,
      recorded_at: timestampSchema,
      created_at_device: timestampSchema,
    }),
    personal: z
      .strictObject({
        personal_snapshot: personalPayloadSchema,
        consent_event_id: uuidSchema,
      })
      .nullable(),
  })
  .superRefine((bundle, ctx) => {
    const snapshot = bundle.report.general_snapshot
    if (snapshot.revision_ids.length === 0 && snapshot.measurements.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['report', 'general_snapshot'], message: 'empty_report' })
    }
    if (snapshot.recipient_assignment_id !== bundle.report.recipient_assignment_id) {
      ctx.addIssue({ code: 'custom', path: ['report', 'recipient_assignment_id'], message: 'recipient_mismatch' })
    }
    if (bundle.report.range_start > bundle.report.range_end) {
      ctx.addIssue({ code: 'custom', path: ['report', 'range_end'], message: 'range_order' })
    }
  })

export const measurementOperationSchema = measurementValueSchema

export const invalidationSchema = z.strictObject({
  id: uuidSchema,
  mission_id: uuidSchema,
  target_type: z.enum(INVALIDATION_TARGETS),
  target_id: uuidSchema,
  reason: z.string().min(1).max(300),
  device_id: deviceIdSchema,
  recorded_at: timestampSchema,
  created_at_device: timestampSchema,
})

export const profilePreferencesSchema = z.strictObject({
  locale: z.enum(['ru', 'en']),
  timezone: timezoneSchema,
  age: z.number().int().min(18).max(100).nullable(),
  sex_context: z.enum(['female', 'male', 'intersex', 'unspecified']).nullable(),
  reproductive_enabled: z.boolean(),
  cycle_context: z.enum(['natural', 'suppression_regimen', 'other']).nullable(),
  default_sharing: z.enum(SHARING_MODES),
})

export const consentChangeSchema = z.strictObject({
  id: uuidSchema,
  mission_id: uuidSchema,
  scope: z.enum(CONSENT_SCOPES),
  decision: z.enum(CONSENT_DECISIONS),
  assignment_id: uuidSchema.nullable(),
  supersedes_id: uuidSchema.nullable(),
  recorded_at: timestampSchema,
  created_at_device: timestampSchema,
})

export const operationTypeSchema = z.enum(OPERATION_TYPES)

const operationSchemas = {
  checkin_bundle: checkinBundleSchema,
  measurement: measurementOperationSchema,
  report_bundle: reportBundleSchema,
  invalidation: invalidationSchema,
  profile_preferences: profilePreferencesSchema,
  consent_change: consentChangeSchema,
  care_order_response: careOrderResponsePayloadSchema,
} as const

export function parseOperationPayload(type: z.infer<typeof operationTypeSchema>, payload: unknown) {
  return operationSchemas[type].safeParse(payload)
}

function integerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}
