import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../app/session.tsx'
import { Banner, Button, Field } from '../../components/ui.tsx'
import { evaluateUsbAttempt, toAttemptSample, type UsbAttemptSample, type UsbEvaluation } from '../../device/usbQuality.ts'
import { USB_COLLECT_MS, USB_STALE_MS, type UsbPacket } from '../../device/usbProtocol.ts'
import { UsbSerialSession, webSerialSupported } from '../../device/webSerial.ts'
import { db } from '../../data/local/db.ts'
import { commitMeasurement, listMeasurements } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import type { LocalMeasurement } from '../../data/local/types.ts'
import { qualityLabel } from '../../domain/labels.ts'
import { t } from '../../i18n/copy.ts'

type Phase =
  | 'disconnected'
  | 'connected'
  | 'waiting_contact'
  | 'collecting'
  | 'evaluating'
  | 'result_valid'
  | 'result_invalid'
  | 'interrupted'

export function UsbMeasurementPanel({
  onSaved,
}: {
  onSaved: (rows: LocalMeasurement[]) => void
}) {
  const session = useSession()
  const locale = session.locale
  const profile = session.profile
  const serialOk = webSerialSupported()

  const [phase, setPhase] = useState<Phase>('disconnected')
  const [deviceId, setDeviceId] = useState('')
  const [firmware, setFirmware] = useState('')
  const [lastPacketAt, setLastPacketAt] = useState<number | null>(null)
  const [liveHr, setLiveHr] = useState<number | null>(null)
  const [contact, setContact] = useState(false)
  const [trace, setTrace] = useState<number[]>([])
  const [remainingMs, setRemainingMs] = useState(USB_COLLECT_MS)
  const [stale, setStale] = useState(false)
  const [evaluation, setEvaluation] = useState<UsbEvaluation | null>(null)
  const [context, setContext] = useState<'rest' | 'after_exertion' | 'other' | 'unspecified'>('rest')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const linkRef = useRef<UsbSerialSession | null>(null)
  const samplesRef = useRef<UsbAttemptSample[]>([])
  const seenSeqRef = useRef<Set<number>>(new Set())
  const sessionIdRef = useRef<string>('')
  const collectStartedRef = useRef<number>(0)
  const attemptIdRef = useRef<string>('')
  const phaseRef = useRef<Phase>('disconnected')

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    return () => {
      void linkRef.current?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (phase !== 'collecting' && phase !== 'waiting_contact') return
    const timer = window.setInterval(() => {
      const started = collectStartedRef.current
      if (!started) return
      const elapsed = Date.now() - started
      setRemainingMs(Math.max(0, USB_COLLECT_MS - elapsed))
      if (lastPacketAt !== null && Date.now() - lastPacketAt > USB_STALE_MS) setStale(true)
      if (elapsed >= USB_COLLECT_MS) finishCollect()
    }, 200)
    return () => window.clearInterval(timer)
  }, [phase, lastPacketAt])

  function onPacket(packet: UsbPacket) {
    setLastPacketAt(Date.now())
    setStale(false)
    if (packet.type === 'hello' || packet.type === 'error') {
      setDeviceId(packet.device_id)
      setFirmware(packet.firmware_version)
      if (packet.type === 'error') setError(packet.code)
      return
    }
    if (packet.type !== 'sample') return
    if (packet.session_id !== sessionIdRef.current) return
    if (seenSeqRef.current.has(packet.seq)) return
    seenSeqRef.current.add(packet.seq)

    setDeviceId(packet.device_id)
    setFirmware(packet.firmware_version)
    setContact(packet.contact_detected)
    setLiveHr(packet.contact_detected ? packet.hr_bpm : null)
    setTrace((prev) => [...prev.slice(-120), packet.raw_ir])

    const sample = toAttemptSample(packet, Date.now())
    samplesRef.current.push(sample)

    const current = phaseRef.current
    if (current === 'waiting_contact' && packet.contact_detected) setPhase('collecting')
    if (current === 'collecting' && !packet.contact_detected) {
      // stay collecting; quality algorithm accounts for contact gaps
    }
  }

  async function connect() {
    setError('')
    setMessage('')
    const link = new UsbSerialSession({
      onPacket: (packet) => onPacket(packet),
      onFatal: (reason) => {
        setError(reason)
        setPhase('interrupted')
        void linkRef.current?.disconnect()
      },
      onDisconnect: () => {
        linkRef.current = null
        if (phaseRef.current === 'collecting' || phaseRef.current === 'waiting_contact') {
          setPhase('interrupted')
          setEvaluation(null)
          setLiveHr(null)
        } else if (phaseRef.current !== 'result_valid' && phaseRef.current !== 'result_invalid') {
          setPhase('disconnected')
        }
      },
    })
    try {
      await link.connect()
      linkRef.current = link
      setPhase('connected')
    } catch {
      setError('connect_failed')
      setPhase('disconnected')
    }
  }

  async function disconnect() {
    await linkRef.current?.disconnect()
    linkRef.current = null
    setPhase('disconnected')
    setLiveHr(null)
    setContact(false)
  }

  async function startMeasure() {
    if (!linkRef.current) return
    setError('')
    setMessage('')
    setEvaluation(null)
    setTrace([])
    samplesRef.current = []
    seenSeqRef.current = new Set()
    sessionIdRef.current = crypto.randomUUID()
    attemptIdRef.current = crypto.randomUUID()
    collectStartedRef.current = Date.now()
    setRemainingMs(USB_COLLECT_MS)
    setStale(false)
    setPhase('waiting_contact')
    await linkRef.current.startSession(sessionIdRef.current)
  }

  async function cancelMeasure() {
    await linkRef.current?.stopSession()
    setPhase(linkRef.current ? 'connected' : 'disconnected')
    setLiveHr(null)
    setEvaluation(null)
  }

  function finishCollect() {
    setPhase('evaluating')
    void linkRef.current?.stopSession()
    const result = evaluateUsbAttempt(samplesRef.current)
    setEvaluation(result)
    setPhase(result.quality === 'valid' ? 'result_valid' : 'result_invalid')
    setLiveHr(result.value)
  }

  async function saveResult() {
    if (!profile || !evaluation || saving) return
    if (evaluation.quality !== 'valid' && evaluation.quality !== 'invalid' && evaluation.quality !== 'insufficient') return
    setSaving(true)
    setError('')
    const now = new Date()
    const id = crypto.randomUUID()
    const operationId = crypto.randomUUID()
    const value = evaluation.quality === 'valid' ? evaluation.value : null
    const row: LocalMeasurement = {
      id,
      owner_id: profile.owner_id,
      environment_id: environmentId,
      operation_id: operationId,
      mission_id: profile.mission_id,
      metric: 'heart_rate',
      value,
      unit: 'bpm',
      input_value: value,
      input_unit: value === null ? null : 'bpm',
      source: 'usb',
      quality: evaluation.quality,
      quality_reasons: evaluation.reasons,
      context,
      note: note.trim() || null,
      instrument: `ESP32 + MAX30102 · ${firmware || 'usb'}`,
      device_id: deviceId || profile.device_id,
      recorded_at: now.toISOString(),
      created_at_device: now.toISOString(),
      demo_dataset_id: profile.demo_dataset_id,
      schema_version: 1,
      delivery: profile.general_exchange ? 'queued' : 'local_only',
      payload_hash: '',
      algorithm_version: evaluation.algorithmVersion,
      attempt_id: attemptIdRef.current,
      device_metadata: {
        instrument: `ESP32 + MAX30102 · ${firmware || 'usb'}`,
        firmware_version: firmware,
        contact_ms: evaluation.contactMs,
        usable_hr_count: evaluation.usableHrCount,
      },
    }
    const payload = {
      id,
      mission_id: profile.mission_id,
      metric: 'heart_rate' as const,
      value,
      unit: 'bpm' as const,
      source: 'usb' as const,
      quality: evaluation.quality,
      quality_reasons: evaluation.reasons,
      context,
      note: note.trim() || null,
      device_metadata: row.device_metadata ?? null,
      algorithm_version: evaluation.algorithmVersion,
      attempt_id: attemptIdRef.current,
      device_id: row.device_id,
      recorded_at: row.recorded_at,
      created_at_device: row.created_at_device,
      demo_dataset_id: profile.demo_dataset_id,
    }
    try {
      const status = await commitMeasurement(db, { ownerId: profile.owner_id, environmentId }, row, payload, profile.general_exchange)
      if (status.status !== 'committed') {
        setError(t(locale, 'saveDeviceFailed'))
      } else {
        setMessage(
          status.delivery === 'queued'
            ? `${t(locale, 'savedMeasurement')} · ${t(locale, 'waitingSend')}`
            : `${t(locale, 'savedMeasurement')} · ${t(locale, 'storedLocally')}`,
        )
        const rows = await listMeasurements(db, { ownerId: profile.owner_id, environmentId })
        onSaved(rows)
        await session.refreshLocal()
      }
    } catch {
      setError(t(locale, 'saveDeviceFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!serialOk) {
    return (
      <article className="rounded-xl border border-line p-4">
        <h2 className="text-xl">{t(locale, 'usbSensor')}</h2>
        <Banner tone="attention">{t(locale, 'usbMissing')}</Banner>
      </article>
    )
  }

  const seconds = Math.ceil(remainingMs / 1000)
  const path = buildTracePath(trace)

  return (
    <article className="flex max-w-2xl flex-col gap-3 rounded-xl border border-accent p-4">
      <div>
        <h2 className="text-xl">{t(locale, 'usbSensor')}</h2>
        <p className="text-sm text-muted">{t(locale, 'usbWiredHint')}</p>
      </div>

      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">{t(locale, 'usbDevice')}</dt>
          <dd className="numeric">{deviceId || '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">{t(locale, 'usbFirmware')}</dt>
          <dd className="numeric">{firmware || '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">{t(locale, 'usbLink')}</dt>
          <dd>{phaseLabel(locale, phase)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t(locale, 'usbSource')}</dt>
          <dd>{t(locale, 'sourceDevice')}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {phase === 'disconnected' ? (
          <Button type="button" onClick={() => void connect()}>
            {t(locale, 'usbConnect')}
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={() => void disconnect()}>
            {t(locale, 'usbDisconnect')}
          </Button>
        )}
        <Button
          type="button"
          disabled={phase !== 'connected' && phase !== 'result_valid' && phase !== 'result_invalid'}
          onClick={() => void startMeasure()}
        >
          {t(locale, 'usbStart')}
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={phase !== 'collecting' && phase !== 'waiting_contact'}
          onClick={() => void cancelMeasure()}
        >
          {t(locale, 'usbCancel')}
        </Button>
      </div>

      {(phase === 'waiting_contact' || phase === 'collecting') && (
        <section className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <p>{t(locale, 'usbFingerHint')}</p>
          <p className="numeric text-sm">
            {t(locale, 'usbTimer')}: {seconds}s · {contact ? t(locale, 'usbContactYes') : t(locale, 'usbContactNo')}
            {liveHr !== null ? ` · ${liveHr} ${t(locale, 'unitBpm')}` : ''}
          </p>
          {stale ? <Banner tone="attention">{t(locale, 'usbStale')}</Banner> : null}
          <svg viewBox="0 0 240 64" className="h-20 w-full rounded-lg bg-canvas" role="img" aria-label={t(locale, 'usbPpgLabel')}>
            <text x="8" y="14" className="fill-current text-[10px] text-muted">
              {t(locale, 'usbPpgLabel')}
            </text>
            {path ? <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent" /> : null}
          </svg>
        </section>
      )}

      {(phase === 'result_valid' || phase === 'result_invalid') && evaluation ? (
        <section className="flex flex-col gap-3 rounded-xl border border-line p-3">
          {evaluation.quality === 'valid' ? (
            <p className="text-2xl numeric">
              {evaluation.value} {t(locale, 'unitBpm')}
            </p>
          ) : (
            <Banner tone="attention">{t(locale, 'usbInvalidResult')}</Banner>
          )}
          <p className="text-sm text-muted">
            {qualityLabel(locale, evaluation.quality)} · {evaluation.algorithmVersion}
            {evaluation.reasons.length ? ` · ${evaluation.reasons.join(', ')}` : ''}
          </p>
          <Field id="usb-context" label={t(locale, 'context')}>
            <select
              id="usb-context"
              className="min-h-11 rounded-xl border border-line bg-canvas px-3"
              value={context}
              onChange={(event) => setContext(event.target.value as typeof context)}
            >
              <option value="rest">{t(locale, 'rest')}</option>
              <option value="after_exertion">{t(locale, 'afterExertion')}</option>
              <option value="other">{t(locale, 'other')}</option>
              <option value="unspecified">{t(locale, 'unspecified')}</option>
            </select>
          </Field>
          <Field id="usb-note" label={t(locale, 'note')} hint={`${note.length}/300`}>
            <textarea
              id="usb-note"
              maxLength={300}
              className="min-h-20 rounded-xl border border-line bg-canvas px-3 py-2"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={saving} onClick={() => void saveResult()}>
              {evaluation.quality === 'valid' ? t(locale, 'usbSaveResult') : t(locale, 'usbSaveAttempt')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void startMeasure()}>
              {t(locale, 'usbRetry')}
            </Button>
            <Button type="button" variant="quiet" onClick={() => setPhase(linkRef.current ? 'connected' : 'disconnected')}>
              {t(locale, 'usbClose')}
            </Button>
          </div>
        </section>
      ) : null}

      {phase === 'interrupted' ? <Banner tone="attention">{t(locale, 'usbInterrupted')}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {message ? <Banner tone="neutral">{message}</Banner> : null}
    </article>
  )
}

function phaseLabel(locale: 'ru' | 'en', phase: Phase): string {
  if (phase === 'disconnected') return t(locale, 'usbPhaseDisconnected')
  if (phase === 'connected') return t(locale, 'usbPhaseConnected')
  if (phase === 'waiting_contact') return t(locale, 'usbPhaseWaiting')
  if (phase === 'collecting') return t(locale, 'usbPhaseCollecting')
  if (phase === 'evaluating') return t(locale, 'usbPhaseEvaluating')
  if (phase === 'result_valid') return t(locale, 'usbPhaseValid')
  if (phase === 'result_invalid') return t(locale, 'usbPhaseInvalid')
  return t(locale, 'usbPhaseInterrupted')
}

function buildTracePath(values: number[]): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 240
      const y = 56 - ((value - min) / span) * 40
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}
