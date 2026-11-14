import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { AppDialog, Button, Card } from '../../components/ui.tsx'
import { formatZoned, localDateInZone } from '../../domain/clock.ts'
import type { GeneralPayload } from '../../domain/generalPayload.ts'
import { db } from '../../data/local/db.ts'
import { hiddenObservationIds, hideObservation, listAudit, listCheckins, listMeasurements, readActiveDraft, readRevisions } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { t } from '../../i18n/copy.ts'
import type { DraftRecord, LocalAudit, LocalCheckin, LocalMeasurement } from '../../data/local/types.ts'

const STALE_MS = 12 * 60 * 60 * 1000

export function TodayPage() {
  const session = useSession()
  const locale = session.locale
  const profile = session.profile
  const [checkins, setCheckins] = useState<LocalCheckin[]>([])
  const [measurements, setMeasurements] = useState<LocalMeasurement[]>([])
  const [draft, setDraft] = useState<DraftRecord | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [events, setEvents] = useState<LocalAudit[]>([])
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
    void readActiveDraft(db, scope).then(setDraft)
    void hiddenObservationIds(db, scope).then(setHidden)
    void listAudit(db, scope).then((rows) => setEvents(rows.slice(0, 5)))
  }, [profile?.owner_id])

  const today = profile ? localDateInZone(openedAt, profile.timezone) : ''
  const completed = checkins.find((item) => item.local_date === today && !item.invalidated)
  useEffect(() => {
    if (!profile || !completed) return
    void readRevisions(db, { ownerId: profile.owner_id, environmentId }, completed.id).then((rows) => {
      setPayload(rows[rows.length - 1]?.general_payload ?? null)
    })
  }, [profile?.owner_id, completed?.id])

  if (!profile) return null
  const latest = measurements[0]
  const stale = latest ? openedAt.getTime() - new Date(latest.recorded_at).getTime() > STALE_MS : false
  const attached = measurements.some((item) => item.recorded_at.slice(0, 10) === today)
  const hints = buildHints(payload, attached, hidden, completed?.id)
  const procedureText = session.mission?.emergency_contact_text.trim() ?? ''

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl">{t(locale, 'today')}</h1>
        <p className="numeric text-muted">{formatZoned(openedAt, profile.timezone, locale === 'ru' ? 'ru' : 'en')}</p>
        <p>{t(locale, 'todaySubtitle')}</p>
      </header>
      <Card
        title={t(locale, 'wellbeing')}
        action={
          draft ? (
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
        }
      >
        <p>{draft ? t(locale, 'draft') : completed ? t(locale, 'completed') : t(locale, 'notFilled')}</p>
        {completed ? (
          <Link className="mt-3 inline-flex min-h-11 items-center" to="/onboard/checkin/new?mode=change&fresh=1">
            {t(locale, 'addRecord')}
          </Link>
        ) : null}
      </Card>
      <Card title={t(locale, 'lastMeasurement')} action={<Link className="inline-flex min-h-11 items-center" to="/onboard/measurements">{t(locale, 'measure')}</Link>}>
        {latest ? (
          <p className="numeric">
            {stale ? t(locale, 'ago', { time: elapsed(locale, latest.recorded_at) }) : null} {latest.metric} {latest.value ?? '—'} {latest.unit} · {latest.source} · {latest.quality}
            <span className="mt-1 block text-sm text-muted">{formatZoned(new Date(latest.recorded_at), profile.timezone, locale === 'ru' ? 'ru' : 'en')}</span>
          </p>
        ) : (
          <p>{t(locale, 'noMeasurement')}</p>
        )}
      </Card>
      <Card title={t(locale, 'attention')}>
        {hints.length === 0 ? <p>{t(locale, 'noHints')}</p> : null}
        <ul className="flex flex-col gap-3">
          {hints.map((hint) => (
            <li key={hint.id}>
              <p>{t(locale, hint.title)}</p>
              <p className="text-sm text-muted">{t(locale, hint.body)}</p>
              <button type="button" className="min-h-11" onClick={() => setWhy(hint.rule)}>
                {t(locale, 'why')}
              </button>
              <button
                type="button"
                className="min-h-11 px-3"
                onClick={() => {
                  if (!completed) return
                  void hideObservation(db, { ownerId: profile.owner_id, environmentId }, hint.rule, completed.id).then(() => {
                    setHidden(new Set(hidden).add(`${hint.rule}:${completed.id}`))
                  })
                }}
              >
                {t(locale, 'hideHome')}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t(locale, 'doctorCard')}>
        <p>{t(locale, 'noReply')}</p>
        <p>{t(locale, 'pendingOps', { count: session.pending })}</p>
      </Card>
      <Card title={t(locale, 'feed')}>
        {events.length === 0 ? <p>{t(locale, 'noEvents')}</p> : null}
        <ul>
          {events.map((event) => (
            <li key={event.id} className="numeric min-h-11">
              {event.event_code} · {formatZoned(new Date(event.recorded_at), profile.timezone, locale === 'ru' ? 'ru' : 'en')}
            </li>
          ))}
        </ul>
      </Card>
      <Button onClick={() => setContact(true)}>{t(locale, 'contact')}</Button>
      <AppDialog open={contact} onOpenChange={setContact} title={t(locale, 'contact')} description={t(locale, 'noEmergencyPromise')}>
        <Button variant="secondary" disabled>
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
        <p className="w-full text-sm text-muted">{why}</p>
        <Button variant="quiet" onClick={() => setWhy(null)}>
          {t(locale, 'close')}
        </Button>
      </AppDialog>
    </div>
  )
}

function buildHints(payload: GeneralPayload | null, hasMeasurement: boolean, hidden: Set<string>, checkinId: string | undefined) {
  if (!payload || !checkinId) return []
  const hints: Array<{ id: string; title: 'noCurrentTitle' | 'reviewTitle'; body: 'noCurrentBody' | 'reviewBody'; rule: string }> = []
  if (!hasMeasurement) hints.push({ id: 'measure', title: 'noCurrentTitle', body: 'noCurrentBody', rule: 'DATA_NO_CURRENT_V1' })
  if (payload.review_requested) hints.push({ id: 'review', title: 'reviewTitle', body: 'reviewBody', rule: 'SELF_REVIEW_REQUEST_V1' })
  return hints.filter((hint) => !hidden.has(`${hint.rule}:${checkinId}`)).slice(0, 3)
}

function elapsed(locale: 'ru' | 'en', iso: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 60) return locale === 'ru' ? `${minutes} мин` : `${minutes} min`
  const hours = Math.round(minutes / 60)
  return locale === 'ru' ? `${hours} ч` : `${hours} h`
}
