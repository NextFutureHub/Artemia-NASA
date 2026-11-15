import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { PageIntro } from '../../components/FormChrome.tsx'
import { AppDialog, Button, Card } from '../../components/ui.tsx'
import { formatZoned, localDateInZone } from '../../domain/clock.ts'
import { explanationCard, type RuleId } from '../../domain/explanations.ts'
import type { GeneralPayload } from '../../domain/generalPayload.ts'
import { feedEventLabel, metricLabel, qualityLabel, sourceLabel } from '../../domain/labels.ts'
import { listCareOrders } from '../../data/local/careOrders.ts'
import { db } from '../../data/local/db.ts'
import { hiddenObservationIds, hideObservation, listCheckins, listMeasurements, listReports, readActiveDraft, readRevisions } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { careKindLabel, careStatusLabel } from '../../domain/labels.ts'
import { displayUnitLabel, formatStoredMeasurement, metricDisplayUnit } from '../../domain/unitSystem.ts'
import { t } from '../../i18n/copy.ts'
import type { DraftRecord, LocalCareOrder, LocalCheckin, LocalMeasurement, LocalMessage, LocalReport } from '../../data/local/types.ts'

const STALE_MS = 12 * 60 * 60 * 1000

type FeedItem = { id: string; at: string; code: string; href: string }

export function TodayPage() {
  const session = useSession()
  const navigate = useNavigate()
  const locale = session.locale
  const profile = session.profile
  const [checkins, setCheckins] = useState<LocalCheckin[]>([])
  const [measurements, setMeasurements] = useState<LocalMeasurement[]>([])
  const [reports, setReports] = useState<LocalReport[]>([])
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [orders, setOrders] = useState<LocalCareOrder[]>([])
  const [draft, setDraft] = useState<DraftRecord | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [payload, setPayload] = useState<GeneralPayload | null>(null)
  const [openedAt] = useState(() => new Date())
  const [contact, setContact] = useState(false)
  const [procedure, setProcedure] = useState(false)
  const [why, setWhy] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    const scope = { ownerId: profile.owner_id, environmentId }
    void listCheckins(db, scope).then(setCheckins)
    void listMeasurements(db, scope).then(setMeasurements)
    void listReports(db, scope).then(setReports)
    void listCareOrders(db, scope).then(setOrders)
    void readActiveDraft(db, scope).then(setDraft)
    void hiddenObservationIds(db, scope).then(setHidden)
    void db.localMessages.where('[owner_id+environment_id]').equals([profile.owner_id, environmentId]).toArray().then((rows) => {
      setMessages(rows.filter((row) => row.owner_id === profile.owner_id && row.environment_id === environmentId))
    })
  }, [profile?.owner_id, session.pending])

  const today = profile ? localDateInZone(openedAt, profile.timezone) : ''
  const completed = checkins.find((item) => item.local_date === today && !item.invalidated)
  useEffect(() => {
    if (!profile || !completed) return
    void readRevisions(db, { ownerId: profile.owner_id, environmentId }, completed.id).then((rows) => {
      setPayload(rows[rows.length - 1]?.general_payload ?? null)
    })
  }, [profile?.owner_id, completed?.id])

  const whyCard = why && isRuleId(why) ? explanationCard(why, [{ label: completed?.id ?? '', href: completed ? `/onboard/checkin/${completed.id}` : null }], openedAt.toISOString()) : null
  if (!profile) return null
  const latest = measurements[0]
  const stale = latest ? openedAt.getTime() - new Date(latest.recorded_at).getTime() > STALE_MS : false
  const attached = measurements.some((item) => item.recorded_at.slice(0, 10) === today)
  const failedMeasurement = measurements.some((item) => item.quality === 'invalid' || item.quality === 'insufficient')
  const hints = buildHints(payload, attached, hidden, completed?.id, session.connection === 'auth_required', failedMeasurement)
  const procedureText = session.mission?.emergency_contact_text.trim() ?? ''
  const doctorMessages = messages
    .filter((row) => row.message_type !== 'crew_note')
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
  const latestReply = doctorMessages[0] ?? null
  const repliedReport =
    reports
      .filter((row) => row.replied_at || row.doctor_work === 'replied')
      .sort((left, right) => (right.replied_at ?? right.created_at_device).localeCompare(left.replied_at ?? left.created_at_device))[0] ?? null
  const doctorHref = latestReply ? `/onboard/reports/${latestReply.report_id}` : repliedReport ? `/onboard/reports/${repliedReport.id}` : null
  const feed = buildFeed(checkins, measurements, reports, doctorMessages).slice(0, 5)
  const activeOrders = orders.filter((row) => row.status === 'active' || row.ack_required).slice(0, 3)
  const dayLabel = session.mission
    ? (() => {
        const start = new Date(session.mission.start_at)
        const ms = openedAt.getTime() - start.getTime()
        const day = Math.floor(ms / 86_400_000) + 1
        if (ms < 0) return t(locale, 'beforeStart', { days: Math.ceil(-ms / 86_400_000) })
        return t(locale, 'missionDay', { day: Math.max(1, day) })
      })()
    : ''
  const connectionText = {
    checking: t(locale, 'checking'),
    online: t(locale, 'serverUp'),
    offline: t(locale, 'serverDown'),
    auth_required: t(locale, 'authRequired'),
  }[session.connection]
  const dailyStatus = draft ? t(locale, 'draft') : completed ? t(locale, 'completed') : t(locale, 'notFilled')
  const dailyAction = draft ? (
    <Link className="inline-flex min-h-11 items-center text-accent" to="/onboard/checkin/new">
      {t(locale, 'resume')}
    </Link>
  ) : completed ? (
    <Link className="inline-flex min-h-11 items-center text-accent" to={`/onboard/checkin/${completed.id}`}>
      {t(locale, 'openRecord')}
    </Link>
  ) : (
    <Link className="inline-flex min-h-11 items-center text-accent" to="/onboard/checkin/new?mode=daily">
      {t(locale, 'fill')}
    </Link>
  )

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        title={t(locale, 'today')}
        meta={formatZoned(openedAt, profile.timezone, locale === 'ru' ? 'ru' : 'en')}
        subtitle={t(locale, 'todaySubtitle')}
      />

      <section className="rounded-xl border border-line bg-surface px-4 py-3">
        <p className="text-sm text-muted">{t(locale, 'missionContext')}</p>
        <p className="text-xl">{session.mission?.name ?? '—'}</p>
        <p className="mt-1 text-sm text-muted">
          {[dayLabel, session.mission?.mode === 'extended' ? t(locale, 'missionModeExtended') : session.mission ? t(locale, 'missionModeShort') : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </section>

      <Card title={t(locale, 'wellbeing')} action={dailyAction}>
        <p className="text-lg">{dailyStatus}</p>
        {completed ? (
          <div className="mt-3 flex flex-col gap-1">
            <Link className="inline-flex min-h-11 items-center text-accent" to="/onboard/checkin/new?mode=change&fresh=1">
              {t(locale, 'addRecord')}
            </Link>
            <p className="text-sm text-muted">{t(locale, 'addEventHint')}</p>
          </div>
        ) : null}
      </Card>

      <Card title={t(locale, 'careCardToday')} action={<Link className="inline-flex min-h-11 items-center" to="/onboard/orders">{t(locale, 'careOpenAll')}</Link>}>
        {activeOrders.length === 0 ? <p className="text-muted">{t(locale, 'careEmpty')}</p> : null}
        <ul className="flex flex-col gap-3">
          {activeOrders.map((order) => {
            const personal = isPersonalCareTask(order)
            const overdue = order.due_at ? Date.now() - new Date(order.due_at).getTime() > 0 && order.status === 'active' : false
            return (
              <li key={order.id}>
                <Link className="block" to="/onboard/orders">
                  <p>{personal ? t(locale, 'personalTask') : order.title}</p>
                  <p className="text-sm text-muted">
                    {personal
                      ? t(locale, 'personalTaskHint')
                      : `${careKindLabel(locale, order.kind)} · ${careStatusLabel(locale, order.status)}`}
                    {!personal && order.ack_required ? ` · ${t(locale, 'careAckNeeded')}` : ''}
                    {!personal && overdue ? ` · ${t(locale, 'careStaleDue')}` : ''}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card title={t(locale, 'activityNav')} action={<Link className="inline-flex min-h-11 items-center" to="/onboard/activity">{t(locale, 'activityAdd')}</Link>}>
        <p className="text-sm text-muted">{t(locale, 'activitySubtitle')}</p>
      </Card>

      <Card title={t(locale, 'lastMeasurement')} action={<Link className="inline-flex min-h-11 items-center" to="/onboard/measurements">{t(locale, 'measure')}</Link>}>
        {latest ? (
          <div className="numeric">
            <p>
              {metricLabel(locale, latest.metric)} {formatStoredMeasurement(latest.metric, latest.value, session.unitSystem) || '—'}{' '}
              {displayUnitLabel(locale, metricDisplayUnit(latest.metric, session.unitSystem))}
            </p>
            <p className="mt-1 text-sm text-muted">
              {t(locale, 'ago', { time: elapsed(locale, latest.recorded_at) })}
              {' · '}
              {sourceLabel(locale, latest.source)} · {qualityLabel(locale, latest.quality)}
              {' · '}
              {stale ? t(locale, 'measurementStale') : t(locale, 'measurementCurrent')}
            </p>
            <p className="mt-1 text-sm text-muted">{formatZoned(new Date(latest.recorded_at), profile.timezone, locale === 'ru' ? 'ru' : 'en')}</p>
          </div>
        ) : (
          <p className="text-muted">{t(locale, 'noMeasurement')}</p>
        )}
      </Card>

      <Card
        title={t(locale, 'doctorCard')}
        action={
          doctorHref ? (
            <Link className="inline-flex min-h-11 items-center text-accent" to={doctorHref}>
              {t(locale, 'openReply')}
            </Link>
          ) : (
            <button type="button" className="inline-flex min-h-11 items-center text-accent" onClick={() => setContact(true)}>
              {t(locale, 'contact')}
            </button>
          )
        }
      >
        {latestReply ? (
          <div>
            <p className="text-sm text-muted">{t(locale, 'latestReply')}</p>
            <p>{latestReply.text}</p>
            <p className="numeric mt-1 text-sm text-muted">
              {formatZoned(new Date(latestReply.created_at), profile.timezone, locale === 'ru' ? 'ru' : 'en')}
            </p>
          </div>
        ) : repliedReport?.replied_at ? (
          <div>
            <p>{t(locale, 'feedDoctorReplied')}</p>
            <p className="numeric mt-1 text-sm text-muted">
              {formatZoned(new Date(repliedReport.replied_at), profile.timezone, locale === 'ru' ? 'ru' : 'en')}
            </p>
          </div>
        ) : (
          <p className="text-muted">{t(locale, 'noReply')}</p>
        )}
      </Card>

      <Card title={t(locale, 'syncCard')} action={<Link className="inline-flex min-h-11 items-center" to="/onboard/sync">{t(locale, 'syncOpen')}</Link>}>
        <p>{connectionText}</p>
        <p className="mt-1 text-sm text-muted">
          {session.pending > 0 ? t(locale, 'pendingOps', { count: session.pending }) : t(locale, 'queueEmptyShort')}
        </p>
      </Card>

      {hints.length > 0 ? (
        <Card title={t(locale, 'attention')}>
          <ul className="flex flex-col gap-3">
            {hints.map((hint) => (
              <li key={hint.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
                <p>{t(locale, hint.title)}</p>
                <p className="text-sm text-muted">{t(locale, hint.body)}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 text-sm text-accent" onClick={() => setWhy(hint.rule)}>
                    {t(locale, 'why')}
                  </button>
                  <button
                    type="button"
                    className="min-h-11 px-1 text-sm text-muted"
                    onClick={() => {
                      if (!completed) return
                      void hideObservation(db, { ownerId: profile.owner_id, environmentId }, hint.rule, completed.id).then(() => {
                        setHidden(new Set(hidden).add(`${hint.rule}:${completed.id}`))
                      })
                    }}
                  >
                    {t(locale, 'hideHome')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={t(locale, 'feed')}>
        {feed.length === 0 ? <p className="text-muted">{t(locale, 'noEvents')}</p> : null}
        <ul>
          {feed.map((event) => (
            <li key={event.id} className="min-h-11">
              <Link className="inline-flex min-h-11 items-center gap-2" to={event.href}>
                <span>{feedEventLabel(locale, event.code)}</span>
                <span className="numeric text-sm text-muted">
                  {formatZoned(new Date(event.at), profile.timezone, locale === 'ru' ? 'ru' : 'en')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Button variant="secondary" onClick={() => setContact(true)}>
        {t(locale, 'contact')}
      </Button>
      <AppDialog open={contact} onOpenChange={setContact} title={t(locale, 'contact')} description={t(locale, 'noEmergencyPromise')}>
        <Button
          variant="secondary"
          onClick={() => {
            setContact(false)
            navigate('/onboard/reports/new?reason=reply_to_doctor')
          }}
        >
          {t(locale, 'prepareMessage')}
        </Button>
        <Button
          onClick={() => {
            setProcedure(true)
          }}
        >
          {t(locale, 'showProcedure')}
        </Button>
        <Button variant="quiet" onClick={() => setContact(false)}>
          {t(locale, 'cancel')}
        </Button>
      </AppDialog>
      <AppDialog open={procedure} onOpenChange={setProcedure} title={t(locale, 'showProcedure')} description={procedureText || t(locale, 'procedureMissing')}>
        <Button variant="quiet" onClick={() => setProcedure(false)}>
          {t(locale, 'close')}
        </Button>
      </AppDialog>
      <AppDialog open={why !== null} onOpenChange={() => setWhy(null)} title={t(locale, 'why')} description={t(locale, 'prototypeRule')}>
        {whyCard ? (
          <div className="flex w-full flex-col gap-2 text-sm">
            <p>{t(locale, 'ruleVersion', { version: whyCard.version })}</p>
            <p>{t(locale, 'ruleInputs')}: {whyCard.inputs.map((item) => item.label).join(', ') || t(locale, 'noEvents')}</p>
            <p className="numeric">{t(locale, 'computedAt', { time: whyCard.computedAt })}</p>
            <p>{why === 'HISTORY_CHANGE_V1' ? t(locale, 'historyChangeLimit') : t(locale, 'prototypeRule')}</p>
          </div>
        ) : null}
        <Button variant="quiet" onClick={() => setWhy(null)}>
          {t(locale, 'close')}
        </Button>
      </AppDialog>
    </div>
  )
}

function isPersonalCareTask(order: LocalCareOrder): boolean {
  return order.kind === 'symptom_monitor'
}

function buildFeed(
  checkins: LocalCheckin[],
  measurements: LocalMeasurement[],
  reports: LocalReport[],
  messages: LocalMessage[],
): FeedItem[] {
  const items: FeedItem[] = []
  for (const row of checkins) {
    items.push({ id: `checkin-${row.id}`, at: row.recorded_at, code: 'checkin_saved', href: `/onboard/checkin/${row.id}` })
  }
  for (const row of measurements) {
    items.push({ id: `measurement-${row.id}`, at: row.recorded_at, code: 'measurement_saved', href: '/onboard/measurements' })
  }
  for (const row of reports) {
    items.push({ id: `report-${row.id}`, at: row.created_at_device, code: 'report_saved', href: `/onboard/reports/${row.id}` })
    if (row.accepted_at) {
      items.push({ id: `accepted-${row.id}`, at: row.accepted_at, code: 'delivery_confirmed', href: `/onboard/reports/${row.id}` })
    }
    if (row.opened_at) {
      items.push({ id: `opened-${row.id}`, at: row.opened_at, code: 'doctor_opened', href: `/onboard/reports/${row.id}` })
    }
  }
  for (const row of messages) {
    if (row.message_type === 'crew_note') continue
    items.push({ id: `reply-${row.id}`, at: row.created_at, code: 'doctor_replied', href: `/onboard/reports/${row.report_id}` })
  }
  return items.sort((left, right) => right.at.localeCompare(left.at))
}

function buildHints(
  payload: GeneralPayload | null,
  hasMeasurement: boolean,
  hidden: Set<string>,
  checkinId: string | undefined,
  authBlocked: boolean,
  failedMeasurement: boolean,
) {
  const hints: Array<{ id: string; title: 'noCurrentTitle' | 'reviewTitle' | 'contactLostTitle' | 'authRuleTitle'; body: 'noCurrentBody' | 'reviewBody' | 'contactLostBody' | 'authRuleBody'; rule: string }> = []
  if (payload && checkinId && !hasMeasurement) hints.push({ id: 'measure', title: 'noCurrentTitle', body: 'noCurrentBody', rule: 'DATA_NO_CURRENT_V1' })
  if (payload?.review_requested) hints.push({ id: 'review', title: 'reviewTitle', body: 'reviewBody', rule: 'SELF_REVIEW_REQUEST_V1' })
  if (failedMeasurement) hints.push({ id: 'contact', title: 'contactLostTitle', body: 'contactLostBody', rule: 'DATA_CONTACT_LOST_V1' })
  if (authBlocked) hints.push({ id: 'auth', title: 'authRuleTitle', body: 'authRuleBody', rule: 'SYNC_AUTH_REQUIRED_V1' })
  return hints.filter((hint) => !checkinId || !hidden.has(`${hint.rule}:${checkinId}`)).slice(0, 3)
}

function isRuleId(value: string): value is RuleId {
  return value === 'DATA_CONTACT_LOST_V1' || value === 'DATA_NO_CURRENT_V1' || value === 'SELF_REVIEW_REQUEST_V1' || value === 'SYNC_AUTH_REQUIRED_V1' || value === 'HISTORY_CHANGE_V1'
}

function elapsed(locale: 'ru' | 'en', iso: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 60) return locale === 'ru' ? `${minutes} мин` : `${minutes} min`
  const hours = Math.round(minutes / 60)
  return locale === 'ru' ? `${hours} ч` : `${hours} h`
}
