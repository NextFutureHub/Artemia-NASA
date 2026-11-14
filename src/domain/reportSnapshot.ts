import type { ReportReason } from './enums.ts'
import { reportSnapshotSchema, type reportBundleSchema } from './operation.ts'
import type { z } from 'zod'

export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>
export type ReportBundle = z.infer<typeof reportBundleSchema>

export type SnapshotMeasurement = ReportSnapshot['measurements'][number]

export type ReportBuildInput = {
  revisionIds: string[]
  measurements: SnapshotMeasurement[]
  reviewRequested: boolean
  preparedAt: string
  message: string | null
  recipientAssignmentId: string
  locale: 'ru' | 'en'
  explanatoryRuleVersions?: ReportSnapshot['explanatory_rule_versions']
}

export function templateSummary(
  locale: 'ru' | 'en',
  stats: { records: number; reviewRequested: boolean; measurements: number; unknownQuality: number },
): string {
  const review = stats.reviewRequested ? (locale === 'ru' ? 'да' : 'yes') : locale === 'ru' ? 'нет' : 'no'
  if (locale === 'ru') {
    return `За период заполнено ${stats.records} записей. Запрос просмотра: ${review}. Прикреплено ${stats.measurements} измерений, из них ${stats.unknownQuality} с неизвестным качеством.`
  }
  return `Filled records in the period: ${stats.records}. Review requested: ${review}. Attached measurements: ${stats.measurements}, of which ${stats.unknownQuality} have unknown quality.`
}

/** The object returned here is the preview and the stored snapshot. */
export function buildReportSnapshot(input: ReportBuildInput): { snapshot: ReportSnapshot | null; issues: string[] } {
  const unknownQuality = input.measurements.filter((item) => item.quality === 'unknown').length
  const summary = templateSummary(input.locale, {
    records: input.revisionIds.length,
    reviewRequested: input.reviewRequested,
    measurements: input.measurements.length,
    unknownQuality,
  })
  const candidate = {
    schema_version: 1 as const,
    revision_ids: input.revisionIds,
    measurements: input.measurements,
    explanatory_rule_versions: input.explanatoryRuleVersions ?? [],
    prepared_at: input.preparedAt,
    message: input.message,
    recipient_assignment_id: input.recipientAssignmentId,
    summary,
  }
  const parsed = reportSnapshotSchema.safeParse(candidate)
  if (!parsed.success) return { snapshot: null, issues: parsed.error.issues.map((issue) => issue.message) }
  return { snapshot: parsed.data, issues: [] }
}

export function previewMatchesSnapshot(preview: ReportSnapshot, stored: ReportSnapshot): boolean {
  return JSON.stringify(preview) === JSON.stringify(stored)
}

export type ReportDelivery = 'local_only' | 'queued' | 'accepted'
export type DoctorWork = 'not_opened' | 'opened' | 'replied'

export function mergeReportStatus(
  delivery: ReportDelivery,
  events: Array<{ event_type: string; server_at: string }>,
): { delivery: ReportDelivery; doctorWork: DoctorWork; openedAt: string | null; repliedAt: string | null } {
  const opened = events.find((event) => event.event_type === 'opened') ?? null
  const replied = events.find((event) => event.event_type === 'replied') ?? null
  const doctorWork: DoctorWork = replied ? 'replied' : opened ? 'opened' : 'not_opened'
  return { delivery, doctorWork, openedAt: opened?.server_at ?? null, repliedAt: replied?.server_at ?? null }
}

export function reportReasonLabel(reason: ReportReason): { ru: string; en: string } {
  if (reason === 'review_request') return { ru: 'Прошу посмотреть', en: 'Please review' }
  if (reason === 'reply_to_doctor') return { ru: 'Ответ на запрос врача', en: 'Reply to the physician' }
  return { ru: 'Плановый отчёт', en: 'Planned report' }
}

export type MemorySlice<T> = { data: T; capturedAt: string }
export type SliceLoad<T> = { kind: 'data'; data: T } | { kind: 'offline' } | { kind: 'denied' }

export function nextMemorySlice<T>(
  current: MemorySlice<T> | null,
  load: SliceLoad<T>,
  now: string,
): { slice: MemorySlice<T> | null; mode: 'live' | 'stale' | 'denied' | 'offline_empty' } {
  if (load.kind === 'denied') return { slice: null, mode: 'denied' }
  if (load.kind === 'data') return { slice: { data: load.data, capturedAt: now }, mode: 'live' }
  if (current) return { slice: current, mode: 'stale' }
  return { slice: null, mode: 'offline_empty' }
}

export function consentApplyState(appliedOnServer: boolean): 'waiting_for_server' | 'applied' {
  return appliedOnServer ? 'applied' : 'waiting_for_server'
}
