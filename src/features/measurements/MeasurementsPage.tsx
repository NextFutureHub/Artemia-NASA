import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useSession } from '../../app/session.tsx'
import { Banner, Button, Field } from '../../components/ui.tsx'
import { dateToZonedInput, zonedInputToDate } from '../../domain/clock.ts'
import { inspectManualMeasurement, type ManualMeasurementDraft } from '../../domain/manualMeasurement.ts'
import type { Metric } from '../../domain/enums.ts'
import { db } from '../../data/local/db.ts'
import { commitMeasurement, listMeasurements } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { issueText, t } from '../../i18n/copy.ts'
import type { LocalMeasurement } from '../../data/local/types.ts'

export function MeasurementsPage() {
  const session = useSession()
  const locale = session.locale
  const profile = session.profile
  const [tab, setTab] = useState<'new' | 'history'>('new')
  const [rows, setRows] = useState<LocalMeasurement[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const form = useForm<ManualMeasurementDraft>({
    defaultValues: {
      metric: null,
      rawValue: '',
      recordedAtLocal: profile ? dateToZonedInput(new Date(), profile.timezone) : '',
      context: 'unspecified',
      instrument: '',
      note: '',
    },
  })

  useEffect(() => {
    if (!profile) return
    void listMeasurements(db, { ownerId: profile.owner_id, environmentId }).then(setRows)
  }, [profile?.owner_id])

  if (!profile) return null
  const serial = 'serial' in navigator
  const values = form.watch()

  async function onSave() {
    if (saving || !profile) return
    const now = new Date()
    const id = crypto.randomUUID()
    const inspected = inspectManualMeasurement(form.getValues(), {
      id,
      missionId: profile.mission_id,
      deviceId: profile.device_id,
      timeZone: profile.timezone,
      now,
      demoDatasetId: profile.demo_dataset_id,
    })
    if (!inspected.payload) {
      setError(issueText(locale, inspected.issues[0]?.message ?? 'invalid'))
      return
    }
    setSaving(true)
    setError('')
    const recorded = zonedInputToDate(form.getValues().recordedAtLocal, profile.timezone) ?? now
    const row: LocalMeasurement = {
      id,
      owner_id: profile.owner_id,
      environment_id: environmentId,
      operation_id: crypto.randomUUID(),
      mission_id: profile.mission_id,
      metric: inspected.payload.metric,
      value: inspected.payload.value,
      unit: inspected.payload.unit,
      source: 'manual',
      quality: 'unknown',
      quality_reasons: [],
      context: inspected.payload.context,
      note: inspected.payload.note,
      instrument: values.instrument.trim() || null,
      device_id: profile.device_id,
      recorded_at: recorded.toISOString(),
      created_at_device: now.toISOString(),
      demo_dataset_id: profile.demo_dataset_id,
      schema_version: 1,
      delivery: profile.general_exchange ? 'queued' : 'local_only',
      payload_hash: '',
    }
    try {
      const status = await commitMeasurement(db, { ownerId: profile.owner_id, environmentId }, row, inspected.payload, profile.general_exchange)
      if (status.status !== 'committed') {
        setError(t(locale, 'saveDeviceFailed'))
      } else {
        setMessage(status.delivery === 'queued' ? `${t(locale, 'savedMeasurement')} · ${t(locale, 'waitingSend')}` : `${t(locale, 'savedMeasurement')} · ${t(locale, 'storedLocally')}`)
        setRows(await listMeasurements(db, { ownerId: profile.owner_id, environmentId }))
        await session.refreshLocal()
      }
    } catch {
      setError(t(locale, 'saveDeviceFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">{t(locale, 'measurements')}</h1>
      <div className="flex gap-2">
        <Button variant={tab === 'new' ? 'primary' : 'quiet'} onClick={() => setTab('new')}>
          {t(locale, 'newMeasurement')}
        </Button>
        <Button variant={tab === 'history' ? 'primary' : 'quiet'} onClick={() => setTab('history')}>
          {t(locale, 'history')}
        </Button>
      </div>
      <section className="grid gap-3 md:grid-cols-3">
        <article className="rounded-xl border border-accent p-3">
          <h2>{t(locale, 'manual')}</h2>
          <p className="text-sm text-muted">{t(locale, 'unknownQuality')}</p>
        </article>
        <article className="rounded-xl border border-line p-3">
          <h2>USB</h2>
          <p className="text-sm">{serial ? t(locale, 'usbLater') : t(locale, 'usbMissing')}</p>
        </article>
        {environmentId === 'demo' ? (
          <article className="rounded-xl border border-dashed border-attention p-3">
            <h2>{t(locale, 'simulation')}</h2>
            <p className="text-sm">{t(locale, 'simulationBody')}</p>
          </article>
        ) : null}
      </section>
      {tab === 'new' ? (
        <form
          className="flex max-w-xl flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void onSave()
          }}
        >
          <Field id="metric" label={t(locale, 'metric')}>
            <select id="metric" className="min-h-11 rounded-xl border border-line bg-canvas px-3" {...form.register('metric', { setValueAs: (value) => (value === '' ? null : value) })}>
              <option value="">{t(locale, 'unspecified')}</option>
              <option value="heart_rate">{t(locale, 'heartRate')}</option>
              <option value="temperature">{t(locale, 'temperature')}</option>
              <option value="spo2">{t(locale, 'spo2')}</option>
            </select>
          </Field>
          <Field id="rawValue" label={t(locale, 'value')} error={error || undefined} hint={unitHint(locale, values.metric)}>
            <input id="rawValue" inputMode="decimal" className="numeric min-h-11 rounded-xl border border-line bg-canvas px-3" {...form.register('rawValue')} />
          </Field>
          <Field id="recordedAtLocal" label={t(locale, 'recordedAt')} hint={profile.timezone}>
            <input id="recordedAtLocal" type="datetime-local" className="min-h-11 rounded-xl border border-line bg-canvas px-3" {...form.register('recordedAtLocal')} />
          </Field>
          <Field id="context" label={t(locale, 'context')}>
            <select id="context" className="min-h-11 rounded-xl border border-line bg-canvas px-3" {...form.register('context')}>
              <option value="rest">{t(locale, 'rest')}</option>
              <option value="after_exertion">{t(locale, 'afterExertion')}</option>
              <option value="other">{t(locale, 'other')}</option>
              <option value="unspecified">{t(locale, 'unspecified')}</option>
            </select>
          </Field>
          <Field id="instrument" label={t(locale, 'instrument')} hint={t(locale, 'unspecified')}>
            <input id="instrument" maxLength={100} className="min-h-11 rounded-xl border border-line bg-canvas px-3" {...form.register('instrument')} />
          </Field>
          <Field id="note" label={t(locale, 'note')} hint={`${values.note.length}/300`}>
            <textarea id="note" maxLength={300} className="min-h-24 rounded-xl border border-line bg-canvas px-3 py-2" {...form.register('note')} />
          </Field>
          {message ? <Banner tone="neutral">{message}</Banner> : null}
          <Button type="submit" disabled={saving}>
            {t(locale, 'saveMeasurement')}
          </Button>
        </form>
      ) : rows.length === 0 ? (
        <p>{t(locale, 'noMeasurement')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-line p-3">
              <p className="numeric">
                {row.metric} {row.value ?? '—'} {row.unit}
              </p>
              <p className="text-sm text-muted">
                {row.source} · {row.quality} · {row.delivery === 'on_server' ? t(locale, 'sourceServer') : row.delivery === 'queued' ? t(locale, 'waitingSend') : t(locale, 'storedLocally')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function unitHint(locale: 'ru' | 'en', metric: Metric | null): string {
  if (metric === 'heart_rate') return t(locale, 'unitBpm')
  if (metric === 'temperature') return t(locale, 'unitC')
  if (metric === 'spo2') return t(locale, 'unitPercent')
  return ''
}
