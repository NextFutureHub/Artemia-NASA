import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { Banner, Button, Field } from '../../components/ui.tsx'
import { db } from '../../data/local/db.ts'
import {
  commitReport,
  listCheckins,
  listMeasurements,
  listMessages,
  listPersonalRevisions,
  listReports,
  markMessageRead,
  readReport,
  readRevisions,
  requestRetry,
  saveMessages,
  saveReportStatus,
} from '../../data/local/journal.ts'
import { apiRequest, environmentId } from '../../data/remote/client.ts'
import { localDateInZone } from '../../domain/clock.ts'
import type { ReportReason } from '../../domain/enums.ts'
import { metricLabel, qualityLabel, sourceLabel } from '../../domain/labels.ts'
import { buildReportSnapshot, mergeReportStatus, reportReasonLabel } from '../../domain/reportSnapshot.ts'
import { label, t } from '../../i18n/copy.ts'
import type { LocalCheckin, LocalMeasurement, LocalMessage, LocalPersonalRevision, LocalReport, LocalRevision } from '../../data/local/types.ts'

export function ReportsPage() {
  const session = useSession()
  const locale = session.locale
  const [rows, setRows] = useState<LocalReport[]>([])
  const [filter, setFilter] = useState<'all' | 'queued' | 'accepted' | 'replied'>('all')

  useEffect(() => {
    if (!session.profile) return
    void listReports(db, { ownerId: session.profile.owner_id, environmentId }).then(setRows)
  }, [session.profile?.owner_id, session.pending])

  const visible = rows.filter((row) => {
    if (filter === 'queued') return row.delivery === 'queued' || row.delivery === 'local_only'
    if (filter === 'accepted') return row.delivery === 'accepted'
    if (filter === 'replied') return row.doctor_work === 'replied'
    return true
  })

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">{t(locale, 'reports')}</h1>
        <Link className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-canvas" to="/onboard/reports/new">
          {t(locale, 'createReport')}
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['all', 'queued', 'accepted', 'replied'] as const).map((item) => (
          <button key={item} type="button" className={`min-h-11 rounded-xl border px-3 ${filter === item ? 'border-accent text-accent' : 'border-line'}`} onClick={() => setFilter(item)}>
            {t(locale, item === 'all' ? 'filterAll' : item === 'queued' ? 'filterQueued' : item === 'accepted' ? 'filterAccepted' : 'filterReplied')}
          </button>
        ))}
      </div>
      {visible.length === 0 ? <p className="text-muted">{t(locale, 'noReports')}</p> : null}
      {visible.map((row) => (
        <Link key={row.id} to={`/onboard/reports/${row.id}`} className="rounded-xl border border-line bg-surface p-4">
          <h2>{row.title}</h2>
          <p className="text-sm text-muted">
            {row.range_start} — {row.range_end} · {row.recipient_label}
          </p>
          <p>
            {deliveryText(locale, row.delivery)} · {workText(locale, row.doctor_work)}
          </p>
        </Link>
      ))}
    </section>
  )
}

export function ReportEditorPage() {
  const session = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const locale = session.locale
  const profile = session.profile
  const [preparedAt] = useState(() => new Date().toISOString())
  const [checkins, setCheckins] = useState<LocalCheckin[]>([])
  const [revisions, setRevisions] = useState<LocalRevision[]>([])
  const [measurements, setMeasurements] = useState<LocalMeasurement[]>([])
  const [personal, setPersonal] = useState<LocalPersonalRevision[]>([])
  const [selectedCheckins, setSelectedCheckins] = useState<string[]>([])
  const [selectedMeasurements, setSelectedMeasurements] = useState<string[]>([])
  const [reason, setReason] = useState<ReportReason>(() => {
    const value = params.get('reason')
    return value === 'review_request' || value === 'reply_to_doctor' || value === 'planned' ? value : 'planned'
  })
  const [message, setMessage] = useState('')
  const [includePersonal, setIncludePersonal] = useState(false)
  const [range, setRange] = useState<'today' | 'week' | 'custom'>('today')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile) return
    const scope = { ownerId: profile.owner_id, environmentId }
    const today = localDateInZone(new Date(), profile.timezone)
    setFrom(today)
    setTo(today)
    void listCheckins(db, scope).then((rows) => {
      setCheckins(rows)
      const preset = params.get('checkin')
      if (preset && rows.some((row) => row.id === preset)) setSelectedCheckins([preset])
    })
    void listMeasurements(db, scope).then(setMeasurements)
    void listPersonalRevisions(db, scope).then(setPersonal)
    void db.localCheckinRevisions.where('[owner_id+environment_id]').equals([profile.owner_id, environmentId]).toArray().then(setRevisions)
  }, [profile?.owner_id])

  const today = profile ? localDateInZone(new Date(), profile.timezone) : ''
  const rangeStart = range === 'week' ? shiftDate(today, -6) : from || today
  const rangeEnd = range === 'today' || range === 'week' ? today : to || today
  const inRange = checkins.filter((row) => row.local_date >= rangeStart && row.local_date <= rangeEnd)
  const chosenRevisions = selectedCheckins
    .map((id) => revisions.filter((row) => row.checkin_id === id).sort((left, right) => left.revision_no - right.revision_no).at(-1))
    .filter((row): row is LocalRevision => row !== undefined)
  const chosenMeasurements = measurements.filter((row) => selectedMeasurements.includes(row.id))
  const reviewRequested = reason === 'review_request' || chosenRevisions.some((row) => row.general_payload.review_requested)
  const shareablePersonal = personal.filter(
    (row) => row.sharing === 'assigned_doctor' && row.consent_event_id && selectedCheckins.includes(row.checkin_id),
  )
  const personalPart = includePersonal ? shareablePersonal[0] ?? null : null
  const title = `Самочувствие · ${rangeEnd || today}`
  const snapshot = useMemo(() => {
    if (!session.assignment?.assignment_id) return null
    return buildReportSnapshot({
      revisionIds: chosenRevisions.map((row) => row.id),
      measurements: chosenMeasurements.map((row) => ({
        measurement_id: row.id,
        metric: row.metric,
        value: row.value,
        unit: row.unit,
        source: row.source,
        quality: row.quality,
        recorded_at: row.recorded_at,
      })),
      reviewRequested,
      preparedAt,
      message: message.trim() === '' ? null : message.trim(),
      recipientAssignmentId: session.assignment.assignment_id,
      locale,
    }).snapshot
  }, [chosenRevisions, chosenMeasurements, reviewRequested, preparedAt, message, session.assignment?.assignment_id, locale])

  if (!profile) return null
  const owner = profile
  const canSend =
    session.assignment?.active === true &&
    session.assignment.assignment_id !== null &&
    chosenRevisions.length + chosenMeasurements.length > 0 &&
    selectedCheckins.every((id) => checkins.find((row) => row.id === id)?.delivery !== 'local_only') &&
    chosenMeasurements.every((row) => row.delivery !== 'local_only')

  async function save() {
    if (saving) return
    if (chosenRevisions.length + chosenMeasurements.length === 0) {
      setFailure(t(locale, 'reportEmpty'))
      return
    }
    if (includePersonal && !personalPart) {
      setFailure(t(locale, 'personalNotShareable'))
      return
    }
    if (!snapshot || !session.assignment?.assignment_id) {
      setFailure(t(locale, 'noRecipient'))
      if (!snapshot) return
    }
    const storedSnapshot = snapshot
    if (!storedSnapshot) return
    setSaving(true)
    const status = await commitReport(db, { ownerId: owner.owner_id, environmentId }, {
      reportId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      title,
      rangeStart,
      rangeEnd,
      reason,
      message: storedSnapshot.message,
      parentReportId: params.get('parent'),
      recipientAssignmentId: session.assignment?.assignment_id ?? null,
      recipientLabel: session.assignment?.doctor_callsign ?? t(locale, 'noPhysician'),
      snapshot: storedSnapshot,
      send: canSend,
      checkinIds: selectedCheckins,
      personal: personalPart?.consent_event_id ? { payload: personalPart.personal_payload, consentEventId: personalPart.consent_event_id } : null,
      dependencies: [],
    })
    setSaving(false)
    if (status.status === 'committed') {
      navigate(`/onboard/reports/${status.entityId}`)
      return
    }
    setFailure(t(locale, 'saveDeviceFailed'))
  }

  return (
    <section className="flex flex-col gap-4 pb-8">
      <h1 className="text-3xl">{t(locale, 'createReport')}</h1>
      {failure ? <Banner tone="attention">{failure}</Banner> : null}
      <Field id="report-title" label={t(locale, 'reportTitle')}>
        <input id="report-title" readOnly value={title} className="min-h-11 rounded-xl border border-line bg-canvas px-3" />
      </Field>
      <div className="flex flex-wrap gap-2">
        {(['today', 'week', 'custom'] as const).map((item) => (
          <button key={item} type="button" className={`min-h-11 rounded-xl border px-3 ${range === item ? 'border-accent text-accent' : 'border-line'}`} onClick={() => setRange(item)}>
            {t(locale, item === 'today' ? 'todayPeriod' : item === 'week' ? 'days7' : 'pickDates')}
          </button>
        ))}
      </div>
      {range === 'custom' ? (
        <div className="flex flex-wrap gap-3">
          <Field id="from" label={t(locale, 'from')}>
            <input id="from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="min-h-11 rounded-xl border border-line bg-canvas px-3" />
          </Field>
          <Field id="to" label={t(locale, 'to')}>
            <input id="to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="min-h-11 rounded-xl border border-line bg-canvas px-3" />
          </Field>
        </div>
      ) : null}
      <fieldset>
        <legend>{t(locale, 'reports')}</legend>
        {inRange.length === 0 ? <p className="text-muted">{t(locale, 'historyEmpty')}</p> : null}
        {inRange.map((row) => (
          <label key={row.id} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={selectedCheckins.includes(row.id)}
              onChange={(event) => setSelectedCheckins((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))}
            />
            <span>{row.local_date}</span>
            <Link to={`/onboard/checkin/${row.id}`}>{t(locale, 'openRecord')}</Link>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t(locale, 'measurements')}</legend>
        {measurements.map((row) => (
          <label key={row.id} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={selectedMeasurements.includes(row.id)}
              onChange={(event) => setSelectedMeasurements((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))}
            />
            <span>
              {metricLabel(locale, row.metric)} · {row.value ?? '—'} · {qualityLabel(locale, row.quality)} · {sourceLabel(locale, row.source)}
            </span>
          </label>
        ))}
      </fieldset>
      <p>{t(locale, 'recipient')}: {session.assignment?.doctor_callsign ?? t(locale, 'noRecipient')}</p>
      <label className="flex flex-col gap-2">
        <span>{t(locale, 'reportReason')}</span>
        <select className="min-h-11 rounded-xl border border-line bg-canvas px-3" value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
          <option value="planned">{t(locale, 'planned')}</option>
          <option value="review_request">{t(locale, 'pleaseReview')}</option>
          <option value="reply_to_doctor">{t(locale, 'replyToDoctor')}</option>
        </select>
      </label>
      <Field id="report-message" label={t(locale, 'reportMessage')}>
        <textarea id="report-message" maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} className="min-h-24 rounded-xl border border-line bg-canvas px-3 py-2" />
      </Field>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={includePersonal} onChange={(event) => setIncludePersonal(event.target.checked)} />
        {t(locale, 'includePersonal')}
      </label>
      <p className="text-sm text-muted">{t(locale, 'personalDefaultOff')}</p>
      <article className="rounded-xl border border-line bg-surface p-4">
        <h2>{t(locale, 'preview')}</h2>
        {snapshot ? (
          <>
            <p>{snapshot.summary}</p>
            <p className="text-sm text-muted">
              {t(locale, 'recipient')}: {session.assignment?.doctor_callsign} · {snapshot.prepared_at}
            </p>
            <ul>
              {snapshot.revision_ids.map((id) => (
                <li key={id} className="numeric text-sm">{id}</li>
              ))}
            </ul>
            <p>{includePersonal && personalPart ? t(locale, 'personalIncluded') : t(locale, 'personalExcluded')}</p>
          </>
        ) : (
          <p>{t(locale, 'noRecipient')}</p>
        )}
      </article>
      <Button type="button" disabled={saving} onClick={() => void save()}>
        {canSend ? t(locale, 'saveReport') : t(locale, 'saveLocalReport')}
      </Button>
    </section>
  )
}

export function ReportViewPage() {
  const { id } = useParams()
  const session = useSession()
  const locale = session.locale
  const [report, setReport] = useState<LocalReport | null>(null)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [tab, setTab] = useState<'content' | 'replies' | 'delivery'>('content')
  const [newer, setNewer] = useState(false)

  useEffect(() => {
    if (!session.profile || !id) return
    const scope = { ownerId: session.profile.owner_id, environmentId }
    void readReport(db, scope, id).then(async (row) => {
      setReport(row)
      if (!row) return
      const groups = await Promise.all(row.checkin_ids.map((checkinId) => readRevisions(db, scope, checkinId)))
      const latest = new Set(groups.map((group) => group.at(-1)?.id).filter((item): item is string => Boolean(item)))
      setNewer(row.general_snapshot.revision_ids.some((revisionId) => !latest.has(revisionId)))
    })
    void listMessages(db, scope, id).then(setMessages)
  }, [session.profile?.owner_id, id, session.pending])

  useEffect(() => {
    if (!session.profile || !session.token || !report || session.connection !== 'online') return
    const scope = { ownerId: session.profile.owner_id, environmentId }
    void apiRequest(`/missions/${report.mission_id}/reports/${report.id}`, { token: session.token }).then(async (response) => {
      if (!response.ok || !isRecord(response.body) || !Array.isArray(response.body.events)) return
      const events = response.body.events.flatMap((event) => {
        if (!isRecord(event) || typeof event.event_type !== 'string' || typeof event.server_at !== 'string') return []
        return [{ event_type: event.event_type, server_at: event.server_at }]
      })
      const merged = mergeReportStatus(report.delivery === 'local_only' ? 'local_only' : 'accepted', events)
      const next = { ...report, delivery: merged.delivery === 'accepted' || report.delivery === 'accepted' ? 'accepted' as const : report.delivery, doctor_work: merged.doctorWork, opened_at: merged.openedAt, replied_at: merged.repliedAt }
      await saveReportStatus(db, scope, next)
      setReport(next)
      if (!Array.isArray(response.body.messages)) return
      const incoming: LocalMessage[] = response.body.messages.flatMap((item) => {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.text !== 'string') return []
        return [{
          id: item.id,
          owner_id: scope.ownerId,
          environment_id: scope.environmentId,
          report_id: report.id,
          message_type: typeof item.message_type === 'string' ? item.message_type : 'comment',
          text: item.text,
          sensitive: false,
          created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
          read_at: null,
        }]
      })
      await saveMessages(db, scope, incoming)
      setMessages(await listMessages(db, scope, report.id))
    })
  }, [report?.id, session.connection, session.token])

  if (!report) return <p>{t(locale, 'noReports')}</p>
  const steps = [
    { label: t(locale, 'savedStep'), done: true, at: report.created_at_device },
    { label: t(locale, 'serverStep'), done: report.delivery === 'accepted', at: report.accepted_at },
    { label: t(locale, 'openedStep'), done: report.doctor_work === 'opened' || report.doctor_work === 'replied', at: report.opened_at },
    { label: t(locale, 'replyStep'), done: report.doctor_work === 'replied', at: report.replied_at },
  ]
  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-3xl">{report.title}</h1>
      <p className="numeric text-sm text-muted">{report.id}</p>
      {newer ? <Banner tone="attention">{t(locale, 'newerRevision')}</Banner> : null}
      <ol className="flex flex-col gap-1">
        {steps.map((step) => (
          <li key={step.label} className={step.done ? '' : 'text-muted'}>
            {step.label}{step.done && step.at ? ` · ${step.at}` : ''}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {(['content', 'replies', 'delivery'] as const).map((item) => (
          <button key={item} type="button" className={`min-h-11 rounded-xl border px-3 ${tab === item ? 'border-accent text-accent' : 'border-line'}`} onClick={() => setTab(item)}>
            {t(locale, item === 'content' ? 'contentTab' : item === 'replies' ? 'repliesTab' : 'deliveryTab')}
          </button>
        ))}
      </div>
      {tab === 'content' ? (
        <section>
          <p>{report.general_snapshot.summary}</p>
          <p className="mt-2 text-sm">{label(locale, reportReasonLabel(report.reason))}</p>
          {report.message ? <p className="mt-2 whitespace-pre-wrap">{report.message}</p> : null}
        </section>
      ) : null}
      {tab === 'replies' ? (
        <section className="flex flex-col gap-3">
          {messages.length === 0 ? <p className="text-muted">{t(locale, 'noReports')}</p> : null}
          {messages.map((message) => (
            <article key={message.id} className="rounded-xl border border-line p-3">
              <p className="whitespace-pre-wrap">{message.text}</p>
              {message.read_at ? <p className="text-sm text-muted">{t(locale, 'readLocal')}</p> : (
                <Button type="button" variant="secondary" onClick={() => {
                  const readAt = new Date().toISOString()
                  void markMessageRead(db, { ownerId: report.owner_id, environmentId }, message.id, readAt).then(() => {
                    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, read_at: readAt } : item))
                  })
                }}>{t(locale, 'markRead')}</Button>
              )}
            </article>
          ))}
        </section>
      ) : null}
      {tab === 'delivery' ? (
        <section>
          <p>{deliveryText(locale, report.delivery)}</p>
          <p>{workText(locale, report.doctor_work)}</p>
          <p className="numeric text-sm">{report.general_hash}</p>
          {report.delivery === 'queued' ? (
            <Button type="button" variant="secondary" onClick={() => void requestRetry(db, { ownerId: report.owner_id, environmentId }, report.operation_id)}>
              {t(locale, 'retrySend')}
            </Button>
          ) : null}
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link className="inline-flex min-h-11 items-center" to={`/onboard/reports/new?parent=${report.id}`}>{t(locale, 'supplement')}</Link>
        <Button type="button" variant="quiet" onClick={() => window.print()}>{t(locale, 'printVersion')}</Button>
      </div>
    </article>
  )
}

function deliveryText(locale: 'ru' | 'en', delivery: LocalReport['delivery']): string {
  if (delivery === 'accepted') return t(locale, 'receivedByServer')
  if (delivery === 'queued') return t(locale, 'waitingSend')
  return t(locale, 'storedLocally')
}

function workText(locale: 'ru' | 'en', work: LocalReport['doctor_work']): string {
  if (work === 'replied') return t(locale, 'replied')
  if (work === 'opened') return t(locale, 'opened')
  return t(locale, 'notOpened')
}

function shiftDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
