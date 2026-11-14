import { hashPayloadPart } from '../../domain/canonicalJson.ts'
import { SCHEMA_VERSION } from '../../domain/schemaVersion.ts'
import type { GeneralPayload } from '../../domain/generalPayload.ts'
import type { ArtemiaDb } from './db.ts'
import type {
  AssignmentCache,
  MissionCache,
  PreparedProfile,
  RuleCache,
  SourceCache,
} from './types.ts'

export type ServerHistoryCheckin = {
  id: string
  mission_id: string
  local_date: string
  timezone: string
  type: 'daily' | 'change'
  root_id: string
  device_id: string
  recorded_at: string
  created_at_device: string
  source: 'manual' | 'usb' | 'simulated'
  demo_dataset_id: string | null
  revisions: Array<{
    id: string
    parent_revision_id: string | null
    revision_no: number
    general_payload: GeneralPayload
    reason: string | null
    schema_version: number
    payload_hash: string
  }>
  measurement_ids: string[]
}

export type ServerHistoryMeasurement = {
  id: string
  metric: 'heart_rate' | 'temperature' | 'spo2'
  value: number | null
  unit: 'bpm' | 'celsius' | 'percent'
  source: 'manual' | 'usb' | 'simulated'
  quality: 'unknown' | 'valid' | 'invalid' | 'insufficient'
  quality_reasons: string[]
  context: 'rest' | 'after_exertion' | 'other' | 'unspecified' | null
  note: string | null
  recorded_at: string
  created_at_device: string
  device_id: string
  demo_dataset_id: string | null
}

export type PreparationBundle = {
  schema_version: number
  role: 'astronaut'
  profile: {
    id: string
    display_name: string
    callsign: string
    locale: 'ru' | 'en'
    timezone: string
  }
  mission: {
        id: string
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
  assignment: {
    id: string
    doctor_id: string
    doctor_callsign: string
    doctor_display_name: string
    valid_from: string
    valid_until: string | null
    revoked_at: string | null
  } | null
  medical_profile: { age: number | null; sex_context: PreparedProfile['sex_context'] }
  personal_preferences: {
    reproductive_enabled: boolean
    cycle_context: string | null
    default_sharing: 'device_only' | 'assigned_doctor'
  }
  sources: Array<Omit<SourceCache, 'owner_id' | 'environment_id' | 'source_id'> & { id: string }>
  rules: Array<Omit<RuleCache, 'owner_id' | 'environment_id'>>
  history: { checkins: ServerHistoryCheckin[]; measurements: ServerHistoryMeasurement[] }
}

export async function storePreparation(
  database: ArtemiaDb,
  environmentId: string,
  bundle: PreparationBundle,
  choices: {
    locale: 'ru' | 'en'
    timezone: string
    reminderTime: string | null
    reminderEnabled: boolean
    reproductiveEnabled: boolean
    sensitiveSharing: 'device_only' | 'assigned_doctor'
    generalExchange: boolean
    storagePersisted: boolean | null
  },
): Promise<'stored' | 'other_owner'> {
  const existing = await database.preparedProfiles.where('environment_id').equals(environmentId).toArray()
  if (existing.some((row) => row.owner_id !== bundle.profile.id)) return 'other_owner'
  const previous = existing.find((row) => row.owner_id === bundle.profile.id)
  const scope = { ownerId: bundle.profile.id, environmentId }
  const profile: PreparedProfile = {
    owner_id: scope.ownerId,
    environment_id: environmentId,
    display_name: bundle.profile.display_name,
    callsign: bundle.profile.callsign,
    mission_id: bundle.mission.id,
    role: 'astronaut',
    locale: choices.locale,
    timezone: choices.timezone,
    reminder_time: choices.reminderTime,
    reminder_enabled: choices.reminderEnabled,
    reminder_last_local_date: previous?.reminder_last_local_date ?? null,
    reproductive_enabled: choices.reproductiveEnabled,
    sensitive_sharing: choices.sensitiveSharing,
    general_exchange: choices.generalExchange,
    age: bundle.medical_profile.age,
    sex_context: bundle.medical_profile.sex_context,
    device_id: previous?.device_id ?? `web.${crypto.randomUUID()}`,
    demo_dataset_id: bundle.mission.demo_dataset_id,
    prepared_at: new Date().toISOString(),
    schema_version: 1,
    storage_persisted: choices.storagePersisted,
  }
  const mission: MissionCache = {
    owner_id: scope.ownerId,
    environment_id: environmentId,
    mission_id: bundle.mission.id,
    code: bundle.mission.code,
    name: bundle.mission.name,
    start_at: bundle.mission.start_at,
    end_at: bundle.mission.end_at,
    mode: bundle.mission.mode,
    default_timezone: bundle.mission.default_timezone,
    emergency_contact_text: bundle.mission.emergency_contact_text,
    ruleset_version: bundle.mission.ruleset_version,
    demo_dataset_id: bundle.mission.demo_dataset_id,
  }
  const assignment: AssignmentCache = {
    owner_id: scope.ownerId,
    environment_id: environmentId,
    assignment_id: bundle.assignment?.id ?? null,
    doctor_id: bundle.assignment?.doctor_id ?? null,
    doctor_callsign: bundle.assignment?.doctor_callsign ?? null,
    doctor_display_name: bundle.assignment?.doctor_display_name ?? null,
    valid_from: bundle.assignment?.valid_from ?? null,
    valid_until: bundle.assignment?.valid_until ?? null,
    active: bundle.assignment !== null && bundle.assignment.revoked_at === null,
  }
  await database.transaction(
    'rw',
    [
      database.preparedProfiles,
      database.missionCache,
      database.assignmentCache,
      database.sourceCache,
      database.ruleCache,
      database.localCheckins,
      database.localCheckinRevisions,
      database.localMeasurements,
    ],
    async () => {
      await database.preparedProfiles.put(profile)
      await database.missionCache.put(mission)
      await database.assignmentCache.put(assignment)
      await database.sourceCache.where('[owner_id+environment_id]').equals([scope.ownerId, environmentId]).delete()
      await database.ruleCache.where('[owner_id+environment_id]').equals([scope.ownerId, environmentId]).delete()
      await database.sourceCache.bulkAdd(
        bundle.sources.map((source) => ({
          owner_id: scope.ownerId,
          environment_id: environmentId,
          source_id: source.id,
          title: source.title,
          organization: source.organization,
          url: source.url,
          local_summary: source.local_summary,
          limitations: source.limitations,
          source_kind: source.source_kind,
          accessed_at: source.accessed_at,
        })),
      )
      await database.ruleCache.bulkAdd(
        bundle.rules.map((rule) => ({
          owner_id: scope.ownerId,
          environment_id: environmentId,
          rule_id: rule.rule_id,
          version: rule.version,
          rule_kind: rule.rule_kind,
          limitations: rule.limitations,
          demo_only: rule.demo_only,
        })),
      )
      for (const checkin of bundle.history.checkins) {
        const current = await database.localCheckins.get(checkin.id)
        if (current) continue
        if (checkin.source !== 'manual') continue
        await database.localCheckins.put({
          id: checkin.id,
          owner_id: scope.ownerId,
          environment_id: environmentId,
          mission_id: checkin.mission_id,
          local_date: checkin.local_date,
          timezone: checkin.timezone,
          type: checkin.type,
          root_id: checkin.root_id,
          device_id: checkin.device_id,
          recorded_at: checkin.recorded_at,
          created_at_device: checkin.created_at_device,
          source: 'manual',
          demo_dataset_id: checkin.demo_dataset_id,
          delivery: 'on_server',
          invalidated: false,
        })
        for (const revision of checkin.revisions) {
          if (revision.schema_version !== SCHEMA_VERSION) continue
          await database.localCheckinRevisions.put({
            id: revision.id,
            owner_id: scope.ownerId,
            environment_id: environmentId,
            checkin_id: checkin.id,
            parent_revision_id: revision.parent_revision_id,
            revision_no: revision.revision_no,
            general_payload: revision.general_payload,
            reason: revision.reason,
            schema_version: 1,
            payload_hash: revision.payload_hash || (await hashPayloadPart(revision.general_payload)),
            created_at_device: checkin.created_at_device,
          })
        }
      }
      for (const measurement of bundle.history.measurements) {
        const current = await database.localMeasurements.get(measurement.id)
        if (current) continue
        await database.localMeasurements.put({
          id: measurement.id,
          owner_id: scope.ownerId,
          environment_id: environmentId,
          operation_id: measurement.id,
          mission_id: bundle.mission.id,
          metric: measurement.metric,
          value: measurement.value,
          unit: measurement.unit,
          source: measurement.source,
          quality: measurement.quality,
          quality_reasons: measurement.quality_reasons,
          context: measurement.context,
          note: measurement.note,
          instrument: null,
          device_id: measurement.device_id,
          recorded_at: measurement.recorded_at,
          created_at_device: measurement.created_at_device,
          demo_dataset_id: measurement.demo_dataset_id,
          schema_version: 1,
          delivery: 'on_server',
          payload_hash: '',
        })
      }
    },
  )
  return 'stored'
}
