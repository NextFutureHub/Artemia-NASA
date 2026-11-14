import Dexie, { type Table } from 'dexie'
import type {
  AssignmentCache,
  DraftRecord,
  LocalAudit,
  LocalCheckin,
  LocalLink,
  LocalMeasurement,
  LocalReceipt,
  LocalRevision,
  MissionCache,
  OutboxItem,
  OwnedRow,
  PreparedProfile,
  RuleCache,
  SourceCache,
} from './types.ts'

export class ArtemiaDb extends Dexie {
  preparedProfiles!: Table<PreparedProfile, [string, string]>
  missionCache!: Table<MissionCache, [string, string, string]>
  assignmentCache!: Table<AssignmentCache, [string, string]>
  consentCache!: Table<OwnedRow & { id: string }, string>
  sourceCache!: Table<SourceCache, [string, string, string]>
  ruleCache!: Table<RuleCache, [string, string, string]>
  drafts!: Table<DraftRecord, string>
  localCheckins!: Table<LocalCheckin, string>
  localCheckinRevisions!: Table<LocalRevision, string>
  localPersonalRevisions!: Table<OwnedRow & { id: string }, string>
  localMeasurements!: Table<LocalMeasurement, string>
  localCheckinMeasurements!: Table<LocalLink, [string, string, string, string]>
  localReports!: Table<OwnedRow & { id: string }, string>
  localPersonalReports!: Table<OwnedRow & { id: string }, string>
  localMessages!: Table<OwnedRow & { id: string }, string>
  outbox!: Table<OutboxItem, string>
  receipts!: Table<LocalReceipt, string>
  syncCursors!: Table<OwnedRow & { id: string; scope: string }, string>
  localAudit!: Table<LocalAudit, string>
  demoSettings!: Table<OwnedRow & { id: string }, string>
  observationHides!: Table<OwnedRow & { id: string; rule_id: string; entity_id: string }, string>

  constructor(name = 'artemia-journal') {
    super(name)
    this.version(1).stores({
      preparedProfiles: '[owner_id+environment_id], environment_id',
      missionCache: '[owner_id+environment_id+mission_id], [owner_id+environment_id]',
      assignmentCache: '[owner_id+environment_id]',
      consentCache: 'id, [owner_id+environment_id]',
      sourceCache: '[owner_id+environment_id+source_id], [owner_id+environment_id]',
      ruleCache: '[owner_id+environment_id+rule_id], [owner_id+environment_id]',
      drafts: 'id, [owner_id+environment_id]',
      localCheckins: 'id, [owner_id+environment_id]',
      localCheckinRevisions: 'id, [owner_id+environment_id], [owner_id+environment_id+checkin_id]',
      localPersonalRevisions: 'id, [owner_id+environment_id]',
      localMeasurements: 'id, [owner_id+environment_id]',
      localCheckinMeasurements: '[owner_id+environment_id+revision_id+measurement_id], [owner_id+environment_id]',
      localReports: 'id, [owner_id+environment_id]',
      localPersonalReports: 'id, [owner_id+environment_id]',
      localMessages: 'id, [owner_id+environment_id]',
      outbox: 'operation_id, [owner_id+environment_id]',
      receipts: 'operation_id, [owner_id+environment_id]',
      syncCursors: 'id, [owner_id+environment_id]',
      localAudit: 'id, [owner_id+environment_id]',
      demoSettings: '[owner_id+environment_id]',
      observationHides: 'id, [owner_id+environment_id]',
    })
  }
}

export const db = new ArtemiaDb()
