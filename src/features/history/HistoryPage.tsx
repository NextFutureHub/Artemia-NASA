import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { Button } from '../../components/ui.tsx'
import { formatZoned, localDateInZone } from '../../domain/clock.ts'
import { db } from '../../data/local/db.ts'
import { listCheckins, listMeasurements } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { t } from '../../i18n/copy.ts'
import type { LocalCheckin, LocalMeasurement } from '../../data/local/types.ts'

type Kind = 'all' | 'checkin' | 'measurement'

export function HistoryPage() {
  const session = useSession()
  const locale = session.locale
  const profile = session.profile
  const [checkins, setCheckins] = useState<LocalCheckin[]>([])
  const [measurements, setMeasurements] = useState<LocalMeasurement[]>([])
  const [range, setRange] = useState<'7' | '30' | 'all' | 'custom'>(profile?.mission_id && session.mission?.mode === 'short' ? '7' : '30')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [applied, setApplied] = useState({ from: '', to: '' })
  const [kind, setKind] = useState<Kind>('all')
  const [source, setSource] = useState<'all' | 'manual' | 'usb' | 'simulated'>('all')
  const [limit, setLimit] = useState(25)

  useEffect(() => {
    if (!profile) return
    const scope = { ownerId: profile.owner_id, environmentId }
    void listCheckins(db, scope).then(setCheckins)
    void listMeasurements(db, scope).then(setMeasurements)
  }, [profile?.owner_id])

  if (!profile) return null
  const today = localDateInZone(new Date(), profile.timezone)
  const start = range === 'all' ? '0000-01-01' : range === 'custom' ? applied.from : shiftDate(today, range === '7' ? -6 : -29)
  const end = range === 'custom' ? applied.to || today : today
  const events = [
    ...checkins.map((item) => ({ id: item.id, at: item.recorded_at, date: item.local_date, kind: 'checkin' as const, source: item.source, href: `/onboard/checkin/${item.id}`, label: item.type })),
    ...measurements.map((item) => ({
      id: item.id,
      at: item.recorded_at,
      date: localDateInZone(new Date(item.recorded_at), profile.timezone),
      kind: 'measurement' as const,
      source: item.source,
      href: '/onboard/measurements',
      label: `${item.metric} ${item.value ?? '—'}`,
    })),
  ]
    .filter((item) => item.date >= start && item.date <= end)
    .filter((item) => kind === 'all' || item.kind === kind)
    .filter((item) => source === 'all' || item.source === source)
    .sort((left, right) => right.at.localeCompare(left.at))

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">{t(locale, 'history')}</h1>
      <p className="text-sm text-muted">{t(locale, 'chartsLater')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant={range === '7' ? 'primary' : 'quiet'} onClick={() => setRange('7')}>{t(locale, 'days7')}</Button>
        <Button variant={range === '30' ? 'primary' : 'quiet'} onClick={() => setRange('30')}>{t(locale, 'days30')}</Button>
        <Button variant={range === 'all' ? 'primary' : 'quiet'} onClick={() => setRange('all')}>{t(locale, 'allTime')}</Button>
        <Button variant={range === 'custom' ? 'primary' : 'quiet'} onClick={() => setRange('custom')}>{t(locale, 'pickDates')}</Button>
      </div>
      {range === 'custom' ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-sm">{t(locale, 'from')}<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="min-h-11 rounded-xl border border-line bg-canvas px-3" /></label>
          <label className="flex flex-col text-sm">{t(locale, 'to')}<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="min-h-11 rounded-xl border border-line bg-canvas px-3" /></label>
          <Button onClick={() => from <= to && setApplied({ from, to })} disabled={from > to}>{t(locale, 'apply')}</Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <select className="min-h-11 rounded-xl border border-line bg-canvas px-3" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
          <option value="all">{t(locale, 'allTypes')}</option>
          <option value="checkin">{t(locale, 'wellbeing')}</option>
          <option value="measurement">{t(locale, 'measurements')}</option>
        </select>
        <select className="min-h-11 rounded-xl border border-line bg-canvas px-3" value={source} onChange={(event) => setSource(event.target.value as 'all' | 'manual' | 'usb' | 'simulated')}>
          <option value="all">{t(locale, 'allTypes')}</option>
          <option value="manual">{t(locale, 'sourceManual')}</option>
          <option value="usb">{t(locale, 'sourceDevice')}</option>
          <option value="simulated">{t(locale, 'sourceSimulated')}</option>
        </select>
      </div>
      {events.length === 0 ? <p>{t(locale, 'historyEmpty')}</p> : null}
      <ul className="flex flex-col gap-2">
        {events.slice(0, limit).map((item) => (
          <li key={item.id}>
            <Link className="flex min-h-11 flex-col justify-center rounded-xl border border-line px-3" to={item.href}>
              <span>{item.label}</span>
              <span className="numeric text-sm text-muted">{formatZoned(new Date(item.at), profile.timezone, locale === 'ru' ? 'ru' : 'en')} · {item.source}</span>
            </Link>
          </li>
        ))}
      </ul>
      {events.length > limit ? <Button variant="quiet" onClick={() => setLimit((value) => value + 25)}>{t(locale, 'loadMore')}</Button> : null}
    </div>
  )
}

function shiftDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
