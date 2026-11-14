import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { Banner, Button, Field } from '../../components/ui.tsx'
import { db } from '../../data/local/db.ts'
import { countPreparedProfiles } from '../../data/local/journal.ts'
import { storePreparation, type PreparationBundle } from '../../data/local/prepareStore.ts'
import { apiRequest, environmentId } from '../../data/remote/client.ts'
import { t } from '../../i18n/copy.ts'

type CheckState = { id: string; label: string; status: 'pending' | 'ok' | 'failed'; detail?: string }

export function PreparePage() {
  const session = useSession()
  const navigate = useNavigate()
  const locale = session.locale
  const [step, setStep] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [timezone, setTimezone] = useState('UTC')
  const [zoneQuery, setZoneQuery] = useState('')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderTime, setReminderTime] = useState('08:00')
  const [personal, setPersonal] = useState(false)
  const [sensitive, setSensitive] = useState<'device_only' | 'assigned_doctor'>('device_only')
  const [exchange, setExchange] = useState(false)
  const [bundle, setBundle] = useState<PreparationBundle | null>(null)
  const [checks, setChecks] = useState<CheckState[]>([])
  const [otherOwner, setOtherOwner] = useState(false)
  const [busy, setBusy] = useState(false)
  const zones = useMemo(() => timeZones().filter((zone) => zone.toLowerCase().includes(zoneQuery.toLowerCase())).slice(0, 12), [zoneQuery])

  useEffect(() => {
    if (!session.token) return
    void apiRequest('/preparation', { token: session.token }).then((response) => {
      if (!isBundle(response.body)) return
      setBundle(response.body)
      setTimezone(response.body.profile.timezone || 'UTC')
      setPersonal(response.body.personal_preferences.reproductive_enabled)
    })
  }, [session.token])

  if (!session.ready) return <p className="p-6">{t(locale, 'loading')}</p>
  if (!session.token) return <Navigate to="/login" replace />

  async function load() {
    if (busy) return
    setBusy(true)
    setOtherOwner(false)
    const interfaceOk = true
    const storageOk = await storageAvailable()
    const persisted = await requestPersistence()
    const low = await storageIsLow()
    const response = await apiRequest('/preparation', { token: session.token ?? undefined })
    const loaded = response.ok && isBundle(response.body) ? response.body : null
    let stored = false
    if (loaded && storageOk) {
      const owners = await countPreparedProfiles(db, environmentId)
      if (owners > 0) {
        const existing = await db.preparedProfiles.where('environment_id').equals(environmentId).toArray()
        if (existing.some((row) => row.owner_id !== loaded.profile.id)) {
          setOtherOwner(true)
        } else {
          stored = (await storePreparation(db, environmentId, loaded, choices(persisted))) === 'stored'
        }
      } else {
        stored = (await storePreparation(db, environmentId, loaded, choices(persisted))) === 'stored'
      }
    }
    if (stored && loaded) {
      setBundle(loaded)
      await session.refreshLocal()
    }
    const serverOk = stored && loaded !== null
    setChecks([
      { id: 'interface', label: t(locale, 'checkInterface'), status: interfaceOk ? 'ok' : 'failed' },
      {
        id: 'storage',
        label: t(locale, 'checkStorage'),
        status: storageOk ? 'ok' : 'failed',
        detail: !storageOk ? t(locale, 'storageFailed') : low ? t(locale, 'lowStorage') : persisted ? t(locale, 'persisted') : t(locale, 'persistDenied'),
      },
      { id: 'profile', label: t(locale, 'checkProfile'), status: serverOk ? 'ok' : 'failed' },
      { id: 'references', label: t(locale, 'checkReferences'), status: serverOk && (loaded?.sources.length ?? 0) > 0 ? 'ok' : 'failed' },
      { id: 'history', label: t(locale, 'checkHistory'), status: serverOk ? 'ok' : 'failed' },
      { id: 'rules', label: t(locale, 'checkRules'), status: serverOk && (loaded?.rules.length ?? 0) > 0 ? 'ok' : 'failed' },
      {
        id: 'assignment',
        label: t(locale, 'checkAssignment'),
        status: serverOk ? 'ok' : 'failed',
        detail: serverOk && !loaded?.assignment ? t(locale, 'assignmentMissing') : undefined,
      },
    ])
    setBusy(false)
  }

  function choices(persisted: boolean | null) {
    return {
      locale,
      timezone,
      reminderTime: reminderEnabled ? reminderTime : null,
      reminderEnabled,
      reproductiveEnabled: personal,
      sensitiveSharing: sensitive,
      generalExchange: exchange,
        storagePersisted: persisted,
    }
  }

  const ready = checks.length > 0 && checks.every((item) => item.status === 'ok') && !otherOwner
  const titles = [t(locale, 'stepProfile'), t(locale, 'stepJournal'), t(locale, 'stepDevice')]

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <p className="text-sm text-attention">{t(locale, 'demo')}</p>
      <h1 className="text-3xl">{t(locale, 'prepareTitle')}</h1>
      <ol className="flex flex-wrap gap-2 text-sm">
        {titles.map((title, index) => (
          <li key={title} className={index === step ? 'text-accent' : 'text-muted'}>
            {index + 1}. {title}
          </li>
        ))}
      </ol>
      {otherOwner ? <Banner tone="danger">{t(locale, 'otherOwner')}</Banner> : null}
      {step === 0 && bundle ? (
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
          <p>{t(locale, 'callsign')}: {bundle.profile.callsign}</p>
          <p>{t(locale, 'name')}: {bundle.profile.display_name}</p>
          <p>{t(locale, 'mission')}: {bundle.mission.name} · {bundle.mission.code}</p>
          <p>{t(locale, 'physician')}: {bundle.assignment ? `${bundle.assignment.doctor_callsign}` : t(locale, 'noPhysician')}</p>
          <p className="numeric text-sm text-muted">{bundle.mission.start_at} — {bundle.mission.end_at} UTC</p>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            {t(locale, 'myData')}
          </label>
          <button type="button" className="min-h-11 text-left text-sm" onClick={() => setReportOpen((value) => !value)}>
            {t(locale, 'reportError')}
          </button>
          {reportOpen ? <p className="text-sm text-muted">{t(locale, 'reportErrorBody')}</p> : null}
        </section>
      ) : null}
      {step === 0 && !bundle ? <Banner tone="attention">{t(locale, 'firstPrepareOffline')}</Banner> : null}
      {step === 1 ? (
        <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
          <Field id="zone-query" label={t(locale, 'timezone')}>
            <input id="zone-query" value={zoneQuery} onChange={(event) => setZoneQuery(event.target.value)} className="min-h-11 rounded-xl border border-line bg-canvas px-3" />
          </Field>
          <div className="flex flex-col gap-1">
            {zones.map((zone) => (
              <button key={zone} type="button" className={`min-h-11 rounded-xl px-3 text-left ${timezone === zone ? 'text-accent' : ''}`} onClick={() => setTimezone(zone)}>
                {zone}
              </button>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={reminderEnabled} onChange={(event) => setReminderEnabled(event.target.checked)} />
            {t(locale, 'reminder')}
          </label>
          <input type="time" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} className="min-h-11 rounded-xl border border-line bg-canvas px-3" />
          <p className="text-sm text-muted">{t(locale, 'reminderHint')}</p>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={personal} onChange={(event) => setPersonal(event.target.checked)} />
            {t(locale, 'personalToggle')}
          </label>
          <p className="text-sm text-muted">{t(locale, 'personalHint')}</p>
          <fieldset>
            <legend>{t(locale, 'sensitiveMode')}</legend>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="sensitive" checked={sensitive === 'device_only'} onChange={() => setSensitive('device_only')} />
              {t(locale, 'deviceOnly')}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="sensitive" checked={sensitive === 'assigned_doctor'} onChange={() => setSensitive('assigned_doctor')} />
              {t(locale, 'assignedDoctor')}
            </label>
          </fieldset>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={exchange} onChange={(event) => setExchange(event.target.checked)} />
            {t(locale, 'exchange')}
          </label>
          <p className="text-sm text-muted">{t(locale, 'exchangeHint')}</p>
        </section>
      ) : null}
      {step === 2 ? (
        <section className="flex flex-col gap-3">
          {checks.map((check) => (
            <div key={check.id} className="rounded-xl border border-line bg-surface p-3">
              <p>
                {check.status === 'ok' ? '✓' : check.status === 'failed' ? '!' : '…'} {check.label}
              </p>
              {check.detail ? <p className="text-sm text-muted">{check.detail}</p> : null}
              {check.status === 'failed' ? (
                <Button variant="quiet" onClick={() => void load()}>
                  {t(locale, 'retry')}
                </Button>
              ) : null}
            </div>
          ))}
          <Button onClick={() => void load()} disabled={busy}>
            {t(locale, 'loadChecks')}
          </Button>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {step > 0 ? (
          <Button variant="quiet" onClick={() => setStep((value) => value - 1)}>
            {t(locale, 'back')}
          </Button>
        ) : null}
        {step < 2 ? (
          <Button disabled={step === 0 && (!bundle || !confirmed)} onClick={() => setStep((value) => value + 1)}>
            {t(locale, 'continue')}
          </Button>
        ) : (
          <Button disabled={!ready} onClick={() => navigate('/onboard/today')}>
            {t(locale, 'startWork')}
          </Button>
        )}
      </div>
    </main>
  )
}

function isBundle(value: unknown): value is PreparationBundle {
  if (typeof value !== 'object' || value === null) return false
  const body = value as PreparationBundle
  return body.schema_version === 1 && typeof body.profile?.id === 'string' && typeof body.mission?.id === 'string' && Array.isArray(body.sources) && Array.isArray(body.rules)
}

async function storageAvailable(): Promise<boolean> {
  try {
    await db.open()
    await db.transaction('rw', db.demoSettings, async () => {
      await db.demoSettings.put({ owner_id: '__probe', environment_id: environmentId, id: 'probe' })
      await db.demoSettings.where('[owner_id+environment_id]').equals(['__probe', environmentId]).delete()
    })
    return true
  } catch {
    return false
  }
}

async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

async function storageIsLow(): Promise<boolean> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate?.quota || estimate.usage === undefined) return false
    return estimate.quota - estimate.usage < 5 * 1024 * 1024
  } catch {
    return false
  }
}

function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  return intl.supportedValuesOf?.('timeZone') ?? ['UTC']
}
