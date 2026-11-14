import type { GeneralPayload } from '../../domain/generalPayload.ts'
import type { PersonalPayload } from '../../domain/personalPayload.ts'
import type { CheckinDraftValues, CheckinStep } from '../../domain/checkinDraft.ts'
import type { DoctorWork, ReportDelivery, ReportSnapshot } from '../../domain/reportSnapshot.ts'
import type {
  CareOrderDecision,
  CareOrderKind,
  CareOrderStatus,
  ConsentDecision,
  ConsentScope,
  MeasurementContext,
  MeasurementQuality,
  MeasurementSource,
  Metric,
  OperationType,
  ReportReason,
  SharingMode,
} from '../../domain/enums.ts'

export type Scope = { ownerId: string; environmentId: string }

export type LocalDelivery = 'local_only' | 'queued' | 'on_server' | 'accepted'

export type PreparedProfile = {
  owner_id: string
  environment_id: string
  display_name: string
  callsign: string
  mission_id: string
  role: 'astronaut'
  locale: 'ru' | 'en'
  timezone: string
  reminder_time: string | null
  reminder_enabled: boolean
  reminder_last_local_date: string | null
  reproductive_enabled: boolean
  sensitive_sharing: 'device_only' | 'assigned_doctor'
  general_exchange: boolean
  age: number | null
  sex_context: 'female' | 'male' | 'intersex' | 'unspecified' | null
  device_id: string
  demo_dataset_id: string | null
  prepared_at: string
  schema_version: 1
  storage_persisted: boolean | null
}

export type MissionCache = {
  owner_id: string
  environment_id: string
  mission_id: string
  code: string
  name: string
  start_at: string
  end_at: string
  mode: 'short' | 'extended'
  default_timezone: string
  emergency_contact_text: string
  ruleset_version: string
  demo_dataset_id: string | null
}

export type AssignmentCache = {
  owner_id: string
  environment_id: string
  assignment_id: string | null
  doctor_id: string | null
  doctor_callsign: string | null
  doctor_display_name: string | null
  valid_from: string | null
  valid_until: string | null
  active: boolean
}

export type SourceCache = {
  owner_id: string
  environment_id: string
  source_id: string
  title: string
  organization: string
  url: string
  local_summary: string
  limitations: string
  source_kind: string
  accessed_at: string
}

export type RuleCache = {
  owner_id: string
  environment_id: string
  rule_id: string
  version: string
  rule_kind: string
  limitations: string
  demo_only: boolean
}

export type DraftRecord = {
  id: string
  owner_id: string
  environment_id: string
  kind: 'checkin'
  status: 'active' | 'completed'
  step: CheckinStep
  intent: 'create' | 'revise'
  checkin_id: string
  revision_id: string
  parent_revision_id: string | null
  revision_no: number
  root_id: string
  reason: string
  operation_id: string | null
  values: CheckinDraftValues
  updated_at: string
}

export type LocalCheckin = {
  id: string
  owner_id: string
  environment_id: string
  mission_id: string
  local_date: string
  timezone: string
  type: 'daily' | 'change'
  root_id: string
  device_id: string
  recorded_at: string
  created_at_device: string
  source: 'manual'
  demo_dataset_id: string | null
  delivery: LocalDelivery
  invalidated: boolean
}

export type LocalRevision = {
  id: string
  owner_id: string
  environment_id: string
  checkin_id: string
  parent_revision_id: string | null
  revision_no: number
  general_payload: GeneralPayload
  reason: string | null
  schema_version: 1
  payload_hash: string
  created_at_device: string
}

export type LocalMeasurement = {
  id: string
  owner_id: string
  environment_id: string
  operation_id: string
  mission_id: string
  metric: Metric
  value: number | null
  unit: 'bpm' | 'celsius' | 'percent'
  source: MeasurementSource
  quality: MeasurementQuality
  quality_reasons: string[]
  context: MeasurementContext | null
  note: string | null
  instrument: string | null
  device_id: string
  recorded_at: string
  created_at_device: string
  demo_dataset_id: string | null
  schema_version: 1
  delivery: LocalDelivery
  payload_hash: string
}

export type LocalLink = {
  owner_id: string
  environment_id: string
  revision_id: string
  measurement_id: string
}

export type OutboxItem = {
  operation_id: string
  owner_id: string
  environment_id: string
  entity_type: OperationType
  entity_id: string
  payload_version: 1
  frozen_payload: unknown
  payload_hash: string
  dependencies: string[]
  state: 'pending' | 'sending' | 'retry_wait' | 'accepted' | 'blocked_auth' | 'blocked_permission' | 'validation_error' | 'conflict'
  attempts: number
  next_attempt_at: string
  last_error_code: string | null
  lease_until: string | null
  created_at: string
}

export type LocalReceipt = {
  operation_id: string
  owner_id: string
  environment_id: string
  entity_type: string
  entity_id: string
  payload_hash: string
  local_committed_at: string
  server_receipt_id: string | null
}

export type LocalPersonalRevision = {
  id: string
  owner_id: string
  environment_id: string
  checkin_id: string
  general_revision_id: string
  personal_payload: PersonalPayload
  payload_hash: string
  sharing: SharingMode
  consent_event_id: string | null
  included_in_outbox: boolean
  schema_version: 1
}

export type LocalConsent = {
  id: string
  owner_id: string
  environment_id: string
  mission_id: string
  scope: ConsentScope
  decision: ConsentDecision
  assignment_id: string | null
  supersedes_id: string | null
  recorded_at: string
  created_at_device: string
  applied_on_server: boolean
  operation_id: string
}

export type LocalReport = {
  id: string
  owner_id: string
  environment_id: string
  mission_id: string
  title: string
  range_start: string
  range_end: string
  reason: ReportReason
  message: string | null
  recipient_assignment_id: string | null
  recipient_label: string
  general_snapshot: ReportSnapshot
  general_hash: string
  parent_report_id: string | null
  readiness: 'finalized'
  delivery: ReportDelivery
  doctor_work: DoctorWork
  operation_id: string
  created_at_device: string
  accepted_at: string | null
  opened_at: string | null
  replied_at: string | null
  checkin_ids: string[]
}

export type LocalPersonalReport = {
  id: string
  owner_id: string
  environment_id: string
  personal_snapshot: PersonalPayload
  personal_hash: string
  consent_event_id: string
  schema_version: 1
}

export type LocalMessage = {
  id: string
  owner_id: string
  environment_id: string
  report_id: string
  message_type: string
  text: string
  sensitive: boolean
  created_at: string
  read_at: string | null
}

export type LocalAudit = {
  id: string
  owner_id: string
  environment_id: string
  recorded_at: string
  component: string
  event_code: string
  operation_id: string | null
  entity_id: string | null
}

export type LocalCareOrder = {
  id: string
  owner_id: string
  environment_id: string
  mission_id: string
  assignment_id: string
  doctor_id: string
  kind: CareOrderKind
  title: string
  instructions: string
  schedule_text: string
  due_at: string | null
  status: CareOrderStatus
  revision_no: number
  cancelled_reason: string | null
  revise_reason: string | null
  ack_required: boolean
  acknowledged_at: string | null
  created_at: string
  updated_at: string
  last_decision: CareOrderDecision | null
  last_note: string | null
  last_response_at: string | null
}

export type OwnedRow = { owner_id: string; environment_id: string }
