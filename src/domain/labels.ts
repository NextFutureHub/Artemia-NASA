import type { MeasurementQuality, MeasurementSource, Metric, OperationType } from './enums.ts'
import { t, type Locale } from '../i18n/copy.ts'

export function metricLabel(locale: Locale, metric: Metric | string): string {
  if (metric === 'heart_rate') return t(locale, 'heartRate')
  if (metric === 'temperature') return t(locale, 'temperature')
  if (metric === 'spo2') return t(locale, 'spo2')
  return metric
}

export function qualityLabel(locale: Locale, quality: MeasurementQuality | string): string {
  if (quality === 'valid') return t(locale, 'qualityValid')
  if (quality === 'invalid') return t(locale, 'qualityInvalid')
  if (quality === 'insufficient') return t(locale, 'qualityInsufficient')
  return t(locale, 'qualityUnknown')
}

export function sourceLabel(locale: Locale, source: MeasurementSource | string): string {
  if (source === 'usb') return t(locale, 'sourceDevice')
  if (source === 'simulated') return t(locale, 'sourceSimulated')
  if (source === 'manual') return t(locale, 'sourceManual')
  return source
}

export function outboxEntityLabel(locale: Locale, entityType: OperationType | string): string {
  if (entityType === 'checkin_bundle') return t(locale, 'entityCheckin')
  if (entityType === 'measurement') return t(locale, 'entityMeasurement')
  if (entityType === 'report_bundle') return t(locale, 'entityReport')
  if (entityType === 'profile_preferences') return t(locale, 'entityPreferences')
  if (entityType === 'consent_change' || entityType === 'invalidation') return t(locale, 'protectedPart')
  return t(locale, 'protectedPart')
}

export function outboxStateLabel(locale: Locale, state: string): string {
  if (state === 'pending') return t(locale, 'outboxPending')
  if (state === 'sending') return t(locale, 'outboxSending')
  if (state === 'retry_wait') return t(locale, 'outboxRetryWait')
  if (state === 'accepted') return t(locale, 'outboxAccepted')
  if (state === 'blocked_auth') return t(locale, 'outboxBlockedAuth')
  if (state === 'blocked_permission') return t(locale, 'outboxBlockedPermission')
  if (state === 'validation_error') return t(locale, 'outboxValidation')
  if (state === 'conflict') return t(locale, 'outboxConflict')
  return state
}

export function feedEventLabel(locale: Locale, code: string): string {
  if (code === 'checkin_saved') return t(locale, 'feedCheckinSaved')
  if (code === 'measurement_saved') return t(locale, 'feedMeasurementSaved')
  if (code === 'report_saved') return t(locale, 'feedReportSaved')
  if (code === 'delivery_confirmed') return t(locale, 'feedDeliveryConfirmed')
  if (code === 'doctor_opened') return t(locale, 'feedDoctorOpened')
  if (code === 'doctor_replied') return t(locale, 'feedDoctorReplied')
  return t(locale, 'feedOther')
}
