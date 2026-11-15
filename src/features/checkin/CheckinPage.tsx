import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { ChoiceButtons } from '../../components/Choices.tsx'
import { OptionalGate, ReviewLine, StepRail } from '../../components/FormChrome.tsx'
import { DateTimePicker } from '../../components/DateTimePicker.tsx'
import { AppDialog, Banner, Button, Field } from '../../components/ui.tsx'
import { dateToZonedInput, formatUtcHm, formatZoned, localDateInZone, missionDay, zonedInputToDate } from '../../domain/clock.ts'
import {
  buildGeneralPayload,
  checkinSteps,
  defaultReportPeriod,
  emptyCheckinDraft,
  emptySymptom,
  isFilledLater,
  issuesForStep,
  payloadToDraft,
  type CheckinDraftValues,
  type CheckinStep,
  type SymptomDraft,
} from '../../domain/checkinDraft.ts'
import { buildCareOrderResponse } from '../../domain/careOrder.ts'
import { buildPersonalPayload } from '../../domain/personalDraft.ts'
import type { CareOrderDecision, SharingMode, SymptomCode } from '../../domain/enums.ts'
import { db } from '../../data/local/db.ts'
import { commitCareOrderResponse, listCareOrders } from '../../data/local/careOrders.ts'
import {
  commitCheckin,
  deleteDraft,
  ensureActiveCheckinDraft,
  listMeasurements,
  readActiveDraft,
  readCheckin,
  readRevisions,
  saveDraft,
  updateProfile,
} from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import {
  contextLabels,
  emotionalLabels,
  impactLabels,
  issueText,
  label,
  onsetLabels,
  overallLabels,
  persistenceLabels,
  symptomLabels,
  t,
} from '../../i18n/copy.ts'
import type { DraftRecord, LocalCareOrder, LocalDelivery, LocalMeasurement } from '../../data/local/types.ts'
import { PersonalStep } from './PersonalStep.tsx'
import { SleepIntervalsPanel } from './SleepIntervalsPanel.tsx'
import { sumSleptIntervalHours, type SleepInterval } from '../../domain/sleepIntervals.ts'

export function CheckinPage() {
  const session = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const locale = session.locale
  const profile = session.profile
  const [draft, setDraft] = useState<DraftRecord | null>(null)
  const [step, setStep] = useState<CheckinStep>('general')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([])
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const [result, setResult] = useState<{ at: string; delivery: LocalDelivery; id: string } | null>(null)
  const [share, setShare] = useState(profile?.general_exchange ?? false)
  const [prompt, setPrompt] = useState<DraftRecord | null>(null)
  const [symptomPrompt, setSymptomPrompt] = useState<'no' | 'declined' | null>(null)
  const [undo, setUndo] = useState<SymptomDraft | null>(null)
  const [measurements, setMeasurements] = useState<LocalMeasurement[]>([])
  const [failure, setFailure] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [procedureOpen, setProcedureOpen] = useState(false)
  const [clockNow, setClockNow] = useState(() => new Date())
  const [personalEnabled, setPersonalEnabled] = useState(profile?.reproductive_enabled ?? false)
  const [sectionEnabled, setSectionEnabled] = useState(profile?.reproductive_enabled ?? false)
  const [sectionSharing, setSectionSharing] = useState<SharingMode>(profile?.sensitive_sharing ?? 'device_only')
  const [measureChoice, setMeasureChoice] = useState<'fill' | 'skip' | null>(null)
  const [careOrders, setCareOrders] = useState<LocalCareOrder[]>([])
  const [careBusyId, setCareBusyId] = useState<string | null>(null)
  const [careMessage, setCareMessage] = useState('')
  const stepRef = useRef(step)
  stepRef.current = step
  const draftRef = useRef(draft)
  draftRef.current = draft
  const form = useForm<CheckinDraftValues>({ defaultValues: emptyCheckinDraft('daily', '') })
  const values = form.watch()

  useEffect(() => {
    if (!profile) return
    setPersonalEnabled(profile.reproductive_enabled)
    setSectionSharing(profile.sensitive_sharing)
  }, [profile?.owner_id, profile?.reproductive_enabled, profile?.sensitive_sharing])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    const scope = { ownerId: profile.owner_id, environmentId }
    void (async () => {
      const active = await readActiveDraft(db, scope)
      if (cancelled) return
      const fresh = params.get('fresh') === '1'
      if (active && fresh) {
        setPrompt(active)
        return
      }
      if (active) {
        openDraft(active)
        return
      }
      const reviseId = params.get('revise')
      const created = await createDraft(profile.owner_id, profile.timezone, params.get('mode') === 'change' ? 'change' : 'daily', reviseId, profile.sensitive_sharing)
      if (!created || cancelled) return
      const stored = await ensureActiveCheckinDraft(db, created)
      if (cancelled) return
      openDraft(stored)
    })()
    void listMeasurements(db, scope).then((rows) => {
      if (!cancelled) setMeasurements(rows)
    })
    void listCareOrders(db, scope).then((rows) => {
      if (!cancelled) setCareOrders(rows)
    })
    return () => {
      cancelled = true
    }
  }, [profile?.owner_id, session.pending])

  useEffect(() => {
    if (!draft) return
    let timer = 0
    const subscription = form.watch((next) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const current = draftRef.current
        if (!current) return
        void saveDraft(db, { ...current, values: next as CheckinDraftValues, step: stepRef.current }).then((time) => {
          setSavedAt(time)
          setDraft({ ...current, values: next as CheckinDraftValues, step: stepRef.current, updated_at: time })
        })
      }, 500)
    })
    return () => {
      window.clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [draft?.id, form])

  function openDraft(next: DraftRecord) {
    const values = applyChangePathDefaults({
      ...emptyCheckinDraft(next.values.type, next.values.recordedAtLocal, next.values.personalSharing ?? 'device_only'),
      ...next.values,
    })
    const visible = checkinSteps(profile?.reproductive_enabled ?? personalEnabled, values.type ?? 'daily')
    setDraft({ ...next, values })
    setStep(visible.includes(next.step) ? next.step : 'general')
    form.reset(values)
    setSavedAt(next.updated_at)
    setMeasureChoice(values.measurementIds.length > 0 ? 'fill' : null)
  }

  if (!profile) return null
  const activeProfile = profile
  const steps = checkinSteps(personalEnabled, values.type ?? 'daily')
  const timeZone = profile.timezone
  const errorFor = (path: string) => {
    const issue = issues.find((item) => item.path === path)
    return issue ? issueText(locale, issue.message) : undefined
  }

  function go(next: CheckinStep) {
    const currentIssues = issuesForStep(step, form.getValues(), timeZone, new Date(), personalEnabled)
    if (steps.indexOf(next) > steps.indexOf(step) && currentIssues.length > 0) {
      setIssues(currentIssues)
      document.getElementById(currentIssues[0]?.path ?? '')?.focus()
      return
    }
    setIssues([])
    setStep(next)
    const current = draftRef.current
    if (!current) return
    void saveDraft(db, { ...current, values: form.getValues(), step: next }).then(setSavedAt)
  }

  async function respondPersonalCare(order: LocalCareOrder, decision: CareOrderDecision, note: string) {
    if (careBusyId || !profile) return
    setCareBusyId(order.id)
    setCareMessage('')
    const now = new Date().toISOString()
    const built = buildCareOrderResponse({
      id: crypto.randomUUID(),
      orderId: order.id,
      missionId: order.mission_id,
      decision,
      note: decision === 'acknowledged' ? null : note.trim() || null,
      linkNote: null,
      recordedAt: now,
      createdAtDevice: now,
    })
    if (!built.payload) {
      setCareMessage(t(locale, 'errors'))
      setCareBusyId(null)
      return
    }
    const result = await commitCareOrderResponse(
      db,
      { ownerId: profile.owner_id, environmentId },
      order,
      built.payload,
      crypto.randomUUID(),
    )
    if (result.status === 'committed') {
      setCareMessage(t(locale, 'careResponseSaved'))
      setCareOrders(await listCareOrders(db, { ownerId: profile.owner_id, environmentId }))
      await session.refreshLocal()
    }
    setCareBusyId(null)
  }

  async function onSave() {
    if (saveLock.current || !draft || !profile) return
    saveLock.current = true
    const now = new Date()
    const currentValues = form.getValues()
    const built = buildGeneralPayload(currentValues, timeZone, now)
    const personalBuilt = buildPersonalPayload(currentValues, personalEnabled)
    const combined = [...built.issues, ...personalBuilt.issues]
    if (!built.payload || combined.length > 0) {
      saveLock.current = false
      setIssues(combined)
      document.getElementById(combined[0]?.path ?? '')?.focus()
      return
    }
    setSaving(true)
    setFailure('')
    const operationId = draft.operation_id ?? crypto.randomUUID()
    const recorded = zonedInputToDate(currentValues.recordedAtLocal, timeZone) ?? now
    const personalCommit = personalBuilt.payload
      ? {
          payload: personalBuilt.payload,
          sharing: currentValues.personalSharing ?? 'device_only',
          personalId: crypto.randomUUID(),
          consentId: crypto.randomUUID(),
          consentOperationId: crypto.randomUUID(),
          assignmentId: session.assignment?.assignment_id ?? null,
        }
      : null
    try {
      const status = await commitCheckin(
        db,
        { ownerId: profile.owner_id, environmentId },
        draft.id,
        operationId,
        built.payload,
        share,
        {
          recordedAt: recorded.toISOString(),
          localDate: localDateInZone(recorded, timeZone),
        },
        personalCommit,
      )
      if (status.status === 'committed') {
        setResult({ at: status.savedAt, delivery: status.delivery, id: status.entityId })
        await session.refreshLocal()
      } else {
        setFailure(t(locale, 'saveDeviceFailed'))
      }
    } catch {
      setFailure(t(locale, 'saveDeviceFailed'))
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  if (result) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl">{t(locale, 'savedOnDevice')}</h1>
        <p className="numeric">{formatZoned(new Date(result.at), timeZone, locale === 'ru' ? 'ru' : 'en')}</p>
        <p>{result.delivery === 'queued' ? t(locale, 'waitingSend') : t(locale, 'storedLocally')}</p>
        <p className="text-sm text-muted">{t(locale, 'notServerReceipt')}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate(`/onboard/checkin/${result.id}`)}>{t(locale, 'openRecord')}</Button>
          <Button variant="secondary" onClick={() => navigate(`/onboard/reports/new?checkin=${result.id}`)}>
            {t(locale, 'prepareReport')}
          </Button>
          <Button variant="quiet" onClick={() => navigate('/onboard/today')}>
            {t(locale, 'backToday')}
          </Button>
        </div>
        <p className="text-sm text-muted">{t(locale, 'reportLater')}</p>
      </section>
    )
  }

  const recorded = zonedInputToDate(values.recordedAtLocal, timeZone)
  const later = recorded ? isFilledLater(recorded, new Date()) : false
  const isChange = values.type === 'change'
  const stepItems = steps.map((item) => ({ id: item, label: t(locale, stepKey(item)) }))
  const day = session.mission ? missionDay(new Date(session.mission.start_at), clockNow) : null
  const dayText =
    day?.phase === 'in_mission'
      ? t(locale, 'missionDay', { day: day.day })
      : day?.phase === 'before'
        ? t(locale, 'beforeStart', { days: day.days })
        : ''
  const procedureText = session.mission?.emergency_contact_text.trim() ?? ''
  const stepIndex = Math.max(0, steps.findIndex((item) => item === step))

  return (
    <form
      className="flex flex-col gap-4 pb-24"
      onSubmit={(event) => {
        event.preventDefault()
        if (step === 'measurements' && measureChoice !== 'fill') {
          setMeasureChoice('skip')
          form.setValue('measurementIds', [])
        }
        if (step === 'review') void onSave()
        else go(steps[steps.indexOf(step) + 1] ?? step)
      }}
    >
      {step === 'general' ? (
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-xs tracking-[0.14em] text-muted">{t(locale, 'crewHealthBrand')}</p>
            <span className="rounded-full border border-accent/40 px-3 py-1 text-xs text-accent">{t(locale, 'statusLocal')}</span>
          </div>
          <h1 className="text-3xl">{isChange ? t(locale, 'change') : t(locale, 'dailyAssessment')}</h1>
          <p className="text-sm text-muted">
            {activeProfile.callsign}
            {dayText ? ` · ${dayText}` : ''}
            {' · '}
            <span className="numeric">{formatUtcHm(clockNow)}</span>
          </p>
        </header>
      ) : (
        <StepRail steps={stepItems} current={step} locale={locale} />
      )}
      {step !== 'general' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            {isChange ? t(locale, 'change') : t(locale, 'daily')} · {t(locale, 'localHint')}
          </p>
          {savedAt ? (
            <p className="numeric text-sm text-muted">
              {t(locale, 'draftSaved', { time: formatZoned(new Date(savedAt), timeZone, locale === 'ru' ? 'ru' : 'en') })}
            </p>
          ) : null}
        </div>
      ) : null}
      {isChange ? <Banner tone="neutral">{t(locale, 'changePathBanner')}</Banner> : null}
      {failure ? <Banner tone="danger">{failure}</Banner> : null}
      {issues.length > 0 ? (
        <Banner tone="attention">
          {t(locale, 'errors')}
          <ul>
            {issues.map((issue) => (
              <li key={issue.path}>{issueText(locale, issue.message)}</li>
            ))}
          </ul>
        </Banner>
      ) : null}

      {step === 'general' ? (
        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl">{t(locale, 'overall')}</h2>
              <p className="numeric text-sm text-muted">{t(locale, 'stepOf', { current: stepIndex + 1, total: steps.length })}</p>
            </div>
            <p className="text-sm text-muted">{t(locale, 'overallPrompt')}</p>
            <ChoiceButtons
              locale={locale}
              labelText={t(locale, 'overall')}
              value={values.overallState}
              onChange={(value) => form.setValue('overallState', value)}
              options={options(overallLabels)}
              hideLegend
            />
          </div>

          <Score
            labelText={t(locale, 'fatigue')}
            value={values.fatigue}
            max={10}
            min={0}
            onChange={(value) => form.setValue('fatigue', value)}
            skip={values.fatigueSkip}
            onSkip={(value) => form.setValue('fatigueSkip', value)}
            locale={locale}
            mode="slider"
            minLabel={t(locale, 'fatigueMin')}
            maxLabel={t(locale, 'fatigueMax')}
          />
          <Score
            labelText={t(locale, 'stress')}
            value={values.stress}
            max={10}
            min={0}
            onChange={(value) => form.setValue('stress', value)}
            skip={values.stressSkip}
            onSkip={(value) => form.setValue('stressSkip', value)}
            locale={locale}
            mode="slider"
            minLabel={t(locale, 'stressMin')}
            maxLabel={t(locale, 'stressMax')}
          />
          <p className="text-sm text-muted">{t(locale, 'notATest')}</p>

          <div className="flex flex-col gap-3 rounded-xl border border-attention/50 px-4 py-3">
            <div>
              <p className="font-medium text-attention">{t(locale, 'urgentSymptomTitle')}</p>
              <p className="mt-1 text-sm text-muted">{t(locale, 'urgentSymptomLead')}</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => setContactOpen(true)}>
              {t(locale, 'openMedicalContact')}
            </Button>
          </div>

          {isChange ? <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">{t(locale, 'sleepSkippedForChange')}</p> : null}

          <Field
            id="recordedAtLocal"
            label={t(locale, 'recordedAt')}
            hint={`${t(locale, 'observationUtcHint')}${recorded ? ` · ${formatUtcHm(recorded)}` : ''}`}
            error={errorFor('recordedAtLocal')}
          >
            <DateTimePicker
              id="recordedAtLocal"
              value={values.recordedAtLocal}
              onChange={(next) => form.setValue('recordedAtLocal', next, { shouldDirty: true })}
              locale={locale}
              timeZone={timeZone}
            />
          </Field>
          {later ? <p className="text-sm text-muted">{t(locale, 'filledLater')}</p> : null}

          <ChoiceButtons locale={locale} labelText={t(locale, 'emotional')} value={values.emotional} onChange={(value) => form.setValue('emotional', value)} options={options(emotionalLabels)} />
          {values.emotional === 'other' ? (
            <Field id="emotionalNote" label={t(locale, 'other')} error={errorFor('emotionalNote')}>
              <input id="emotionalNote" maxLength={120} className="min-h-11 rounded-xl border border-line bg-canvas px-3" {...form.register('emotionalNote')} />
            </Field>
          ) : null}
          <ChoiceMulti locale={locale} values={values.context} onChange={(next) => form.setValue('context', next)} />
          <Field id="comment" label={t(locale, 'comment')} hint={`${values.comment.length}/1000`}>
            <textarea id="comment" maxLength={1000} className="min-h-24 rounded-xl border border-line bg-canvas px-3 py-2" {...form.register('comment')} />
          </Field>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={personalEnabled}
              onChange={(event) => {
                const enabled = event.target.checked
                setPersonalEnabled(enabled)
                void updateProfile(db, { ...activeProfile, reproductive_enabled: enabled }).then(() => session.refreshLocal())
              }}
            />
            {t(locale, 'personalToggle')}
          </label>
          <p className="text-sm text-muted">{t(locale, 'personalHint')}</p>
        </section>
      ) : null}

      {step === 'sleep' ? (
        <section className="flex flex-col gap-4" aria-labelledby="sleep-step-heading">
          <h2 id="sleep-step-heading" className="sr-only">{t(locale, 'sleepStep')}</h2>
          <p className="text-sm text-muted">{t(locale, 'sleepPeriodHint')}</p>
          <p className="text-sm text-muted">{t(locale, 'sleepZeroHint')}</p>
          <Field id="sleepHours" label={t(locale, 'sleep')} error={errorFor('sleepHours')}>
            <input id="sleepHours" inputMode="decimal" disabled={values.sleepSkip} className="min-h-11 rounded-xl border border-line bg-canvas px-3 disabled:opacity-50" {...form.register('sleepHours')} />
          </Field>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={values.sleepSkip} onChange={(event) => { form.setValue('sleepSkip', event.target.checked); if (event.target.checked) { form.setValue('sleepHours', ''); form.setValue('sleepDurationSource', null) } }} />
            {t(locale, 'sleepUnknown')}
          </label>
          {!values.sleepSkip && values.sleepHours.trim() === '0' ? (
            <p className="text-sm text-muted">{t(locale, 'answerZero')}</p>
          ) : null}
          <Score labelText={t(locale, 'sleepQuality')} value={values.sleepQuality} max={5} min={1} onChange={(value) => form.setValue('sleepQuality', value)} skip={values.sleepQualitySkip} onSkip={(value) => form.setValue('sleepQualitySkip', value)} locale={locale} />
          <ChoiceButtons locale={locale} labelText={t(locale, 'sleepiness')} value={values.sleepinessSkip ? 'skip' : values.sleepiness} onChange={(value) => { if (value === 'skip') { form.setValue('sleepinessSkip', true); form.setValue('sleepiness', null) } else { form.setValue('sleepinessSkip', false); form.setValue('sleepiness', value) } }} options={[{ value: 'none', label: { ru: 'Не было', en: 'None' } }, { value: 'mild', label: { ru: 'Небольшая', en: 'Mild' } }, { value: 'marked', label: { ru: 'Выраженная', en: 'Marked' } }, { value: 'skip', label: { ru: 'Не оценивать', en: 'Do not rate' } }]} />
          <ChoiceButtons locale={locale} labelText={t(locale, 'awakenings')} value={values.awakeningsSkip ? 'skip' : values.awakenings} onChange={(value) => { if (value === 'skip') { form.setValue('awakeningsSkip', true); form.setValue('awakenings', null) } else { form.setValue('awakeningsSkip', false); form.setValue('awakenings', value) } }} options={[{ value: 'none', label: { ru: 'Не было', en: 'None' } }, { value: 'occurred', label: { ru: 'Были', en: 'Occurred' } }, { value: 'unknown', label: { ru: 'Не помню', en: "Don't remember" } }, { value: 'skip', label: { ru: 'Не оценивать', en: 'Do not rate' } }]} />
          <ChoiceButtons locale={locale} labelText={t(locale, 'sleepPlanDeviation')} value={values.sleepPlanDeviationSkip ? 'skip' : values.sleepPlanDeviation} onChange={(value) => { if (value === 'skip') { form.setValue('sleepPlanDeviationSkip', true); form.setValue('sleepPlanDeviation', null) } else { form.setValue('sleepPlanDeviationSkip', false); form.setValue('sleepPlanDeviation', value) } }} options={[{ value: 'no', label: { ru: 'Нет', en: 'No' } }, { value: 'yes', label: { ru: 'Да', en: 'Yes' } }, { value: 'no_plan', label: { ru: 'План не задан', en: 'No plan set' } }, { value: 'unknown', label: { ru: 'Не знаю', en: "I don't know" } }, { value: 'skip', label: { ru: 'Не оценивать', en: 'Do not rate' } }]} />
          <fieldset>
            <legend className="mb-2 text-sm">{t(locale, 'sleepInterfering')}</legend>
            <label className="mb-2 flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={values.sleepInterferingSkip} onChange={(event) => { form.setValue('sleepInterferingSkip', event.target.checked); if (event.target.checked) form.setValue('sleepInterfering', []) }} />
              {t(locale, 'skipRate')}
            </label>
            {!values.sleepInterferingSkip ? (
              <div className="flex flex-wrap gap-2">
                {([['noise', { ru: 'Шум', en: 'Noise' }], ['light', { ru: 'Свет', en: 'Light' }], ['tasks', { ru: 'Задачи', en: 'Tasks' }], ['discomfort', { ru: 'Дискомфорт', en: 'Discomfort' }], ['other', { ru: 'Другое', en: 'Other' }]] as const).map(([code, labels]) => {
                  const selected = values.sleepInterfering.includes(code)
                  return (
                    <button key={code} type="button" aria-pressed={selected} className={`min-h-11 rounded-xl border px-3 ${selected ? 'border-accent text-accent' : 'border-line'}`} onClick={() => form.setValue('sleepInterfering', selected ? values.sleepInterfering.filter((item) => item !== code) : [...values.sleepInterfering, code])}>
                      {label(locale, labels)}
                    </button>
                  )
                })}
              </div>
            ) : null}
            {!values.sleepInterferingSkip && values.sleepInterfering.includes('other') ? (
              <Field id="sleepInterferingOther" label={t(locale, 'other')} error={errorFor('sleepInterferingOther')}>
                <input id="sleepInterferingOther" maxLength={120} className="mt-2 min-h-11 rounded-xl border border-line bg-canvas px-3" {...form.register('sleepInterferingOther')} />
              </Field>
            ) : null}
          </fieldset>
          <ChoiceButtons locale={locale} labelText={t(locale, 'sleepDiscuss')} value={values.sleepDiscussSkip ? 'skip' : values.sleepDiscuss === null ? null : values.sleepDiscuss ? 'yes' : 'no'} onChange={(value) => { if (value === 'skip') { form.setValue('sleepDiscussSkip', true); form.setValue('sleepDiscuss', null) } else { form.setValue('sleepDiscussSkip', false); form.setValue('sleepDiscuss', value === 'yes') } }} options={[{ value: 'yes', label: { ru: 'Да', en: 'Yes' } }, { value: 'no', label: { ru: 'Нет', en: 'No' } }, { value: 'skip', label: { ru: 'Не оценивать', en: 'Do not rate' } }]} />
          <Field id="sleepComment" label={t(locale, 'sleepComment')} hint={`${values.sleepComment.length}/500`}>
            <textarea id="sleepComment" maxLength={500} className="min-h-20 rounded-xl border border-line bg-canvas px-3 py-2" {...form.register('sleepComment')} />
          </Field>
          <SleepIntervalsPanel
            locale={locale}
            timeZone={timeZone}
            overallHoursRaw={values.sleepHours}
            overallUnknown={values.sleepSkip}
            intervals={values.sleepIntervals}
            durationSource={values.sleepDurationSource}
            onIntervalsChange={(next) => form.setValue('sleepIntervals', next)}
            onDurationSourceChange={(next) => form.setValue('sleepDurationSource', next)}
          />
        </section>
      ) : null}

      {step === 'nutrition' ? (
        <OptionalGate locale={locale} title={t(locale, 'nutritionStep')} lead={t(locale, 'nutritionHint')} choice={values.nutritionFill === 'filled' ? 'fill' : values.nutritionFill === 'skipped' ? 'skip' : null} onFill={() => form.setValue('nutritionFill', 'filled')} onSkip={() => form.setValue('nutritionFill', 'skipped')}>
          {values.nutritionFill === 'filled' ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-dashed border-line p-3">
                <p className="text-sm text-muted">{t(locale, 'nutritionPeriodTitle')}</p>
                <p className="mt-1 text-sm text-muted">{t(locale, 'nutritionPeriodLead')}</p>
                <div className="mt-3 flex flex-col gap-3">
                  <Field id="nutritionPeriodStartLocal" label={t(locale, 'nutritionPeriodStart')} error={errorFor('nutritionPeriodStartLocal')} hint={t(locale, 'nutritionPeriodDefault')}>
                    <DateTimePicker
                      id="nutritionPeriodStartLocal"
                      value={values.nutritionPeriodStartLocal}
                      onChange={(next) => form.setValue('nutritionPeriodStartLocal', next, { shouldDirty: true })}
                      locale={locale}
                      timeZone={timeZone}
                    />
                  </Field>
                  <Field id="nutritionPeriodEndLocal" label={t(locale, 'nutritionPeriodEnd')} error={errorFor('nutritionPeriodEndLocal')}>
                    <DateTimePicker
                      id="nutritionPeriodEndLocal"
                      value={values.nutritionPeriodEndLocal}
                      onChange={(next) => form.setValue('nutritionPeriodEndLocal', next, { shouldDirty: true })}
                      locale={locale}
                      timeZone={timeZone}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      const observed = zonedInputToDate(form.getValues().recordedAtLocal, timeZone) ?? new Date()
                      const period = defaultReportPeriod(observed)
                      form.setValue('nutritionPeriodStartLocal', dateToZonedInput(new Date(period.start_at), timeZone), { shouldDirty: true })
                      form.setValue('nutritionPeriodEndLocal', dateToZonedInput(new Date(period.end_at), timeZone), { shouldDirty: true })
                      setIssues((current) => current.filter((issue) => issue.path !== 'nutritionPeriodStartLocal' && issue.path !== 'nutritionPeriodEndLocal'))
                    }}
                  >
                    {t(locale, 'nutritionPeriodApplyDefault')}
                  </Button>
                </div>
                {(values.nutritionPeriodStartLocal.trim() !== '' || values.nutritionPeriodEndLocal.trim() !== '') ? (
                  <p className="mt-2 text-sm text-muted">{t(locale, 'nutritionHistoryOverlapHint')}</p>
                ) : null}
              </div>
              <ChoiceButtons locale={locale} labelText={t(locale, 'appetite')} value={values.appetiteSkip ? 'skip' : values.appetite} onChange={(value) => { if (value === 'skip') { form.setValue('appetiteSkip', true); form.setValue('appetite', null) } else { form.setValue('appetiteSkip', false); form.setValue('appetite', value) } }} options={[{ value: 'usual', label: { ru: 'Обычный', en: 'Usual' } }, { value: 'decreased', label: { ru: 'Снижен', en: 'Decreased' } }, { value: 'increased', label: { ru: 'Повышен', en: 'Increased' } }, { value: 'skip', label: { ru: 'Не оценивать', en: 'Do not rate' } }]} />
              <ChoiceButtons locale={locale} labelText={t(locale, 'mealPlan')} value={values.mealPlanSkip ? 'skip' : values.mealPlan} onChange={(value) => { if (value === 'skip') { form.setValue('mealPlanSkip', true); form.setValue('mealPlan', null) } else { form.setValue('mealPlanSkip', false); form.setValue('mealPlan', value) } }} options={[{ value: 'full', label: { ru: 'Полностью', en: 'Fully' } }, { value: 'partial', label: { ru: 'Частично', en: 'Partially' } }, { value: 'not_done', label: { ru: 'Не выполнен', en: 'Not done' } }, { value: 'no_plan', label: { ru: 'План не задан', en: 'No plan set' } }, { value: 'unknown', label: { ru: 'Не знаю', en: "I don't know" } }, { value: 'skip', label: { ru: 'Не оценивать', en: 'Do not rate' } }]} />
              {!values.mealPlanSkip && (values.mealPlan === 'partial' || values.mealPlan === 'not_done') ? (
                <>
                  <Field id="missedMeals" label={t(locale, 'missedMeals')} error={errorFor('missedMeals')}>
                    <input id="missedMeals" inputMode="numeric" disabled={values.missedMealsUnknown} className="min-h-11 rounded-xl border border-line bg-canvas px-3 disabled:opacity-50" {...form.register('missedMeals')} />
                  </Field>
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" checked={values.missedMealsUnknown} onChange={(event) => form.setValue('missedMealsUnknown', event.target.checked)} />
                    {t(locale, 'sleepUnknown')}
                  </label>
                  <ChoiceButtons locale={locale} labelText={t(locale, 'nutritionDeviation')} value={values.deviationReasonSkip ? 'skip' : values.deviationReason} onChange={(value) => { if (value === 'skip') { form.setValue('deviationReasonSkip', true); form.setValue('deviationReason', null) } else { form.setValue('deviationReasonSkip', false); form.setValue('deviationReason', value) } }} options={[{ value: 'no_appetite', label: { ru: 'Нет аппетита', en: 'No appetite' } }, { value: 'nausea', label: { ru: 'Тошнота', en: 'Nausea' } }, { value: 'no_time', label: { ru: 'Нет времени', en: 'No time' } }, { value: 'other', label: { ru: 'Другое', en: 'Other' } }, { value: 'declined', label: { ru: 'Не указывать', en: 'Prefer not to say' } }, { value: 'skip', label: { ru: 'Не оценивать', en: 'Do not rate' } }]} />
                </>
              ) : null}
              <Field id="fluidRaw" label={t(locale, 'fluidMl')} error={errorFor('fluidRaw')} hint={t(locale, 'fluidHint')}>
                <input id="fluidRaw" inputMode="numeric" disabled={values.fluidSkip} className="min-h-11 rounded-xl border border-line bg-canvas px-3 disabled:opacity-50" {...form.register('fluidRaw')} />
              </Field>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={values.fluidSkip} onChange={(event) => { form.setValue('fluidSkip', event.target.checked); if (event.target.checked) { form.setValue('fluidRaw', ''); form.setValue('fluidCompleteness', null) } }} />
                {t(locale, 'fluidNotTracked')}
              </label>
              {!values.fluidSkip && values.fluidRaw.trim() === '0' ? (
                <p className="text-sm text-muted">{t(locale, 'fluidZeroAnswer')}</p>
              ) : null}
              {!values.fluidSkip ? (
                <>
                  <ChoiceButtons locale={locale} labelText={t(locale, 'fluidCompleteness')} value={values.fluidCompleteness} onChange={(value) => form.setValue('fluidCompleteness', value)} options={[{ value: 'full', label: { ru: 'Полный', en: 'Complete' } }, { value: 'partial', label: { ru: 'Частичный', en: 'Partial' } }, { value: 'unknown', label: { ru: 'Не знаю', en: "I don't know" } }]} />
                  {values.fluidCompleteness === null && values.fluidRaw.trim() !== '' ? (
                    <p className="text-sm text-muted">{t(locale, 'fluidCompletenessRequired')}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted">{t(locale, 'fluidNotTracked')}</p>
              )}
              <Field id="nutritionComment" label={t(locale, 'comment')} hint={`${values.nutritionComment.length}/500`}>
                <textarea id="nutritionComment" maxLength={500} className="min-h-20 rounded-xl border border-line bg-canvas px-3 py-2" {...form.register('nutritionComment')} />
              </Field>
            </div>
          ) : null}
        </OptionalGate>
      ) : null}

      {step === 'symptoms' ? (
        <section className="flex flex-col gap-4">
          <ChoiceButtons
            locale={locale}
            labelText={t(locale, 'symptomQuestion')}
            value={values.symptomPresence}
            onChange={(value) => {
              if (value !== 'yes' && values.symptoms.length > 0) setSymptomPrompt(value)
              else form.setValue('symptomPresence', value)
            }}
            options={[
              { value: 'no', label: { ru: 'Нет', en: 'No' } },
              { value: 'yes', label: { ru: 'Да', en: 'Yes' } },
              { value: 'declined', label: { ru: 'Не хочу отвечать', en: 'I do not want to answer' } },
            ]}
          />
          {values.symptomPresence === 'yes' ? (
            <>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(symptomLabels) as SymptomCode[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    className="min-h-11 rounded-xl border border-line px-3"
                    onClick={() => {
                      if (values.symptoms.some((item) => item.code === code)) return
                      form.setValue('symptoms', [...values.symptoms, emptySymptom(code)])
                    }}
                  >
                    {label(locale, symptomLabels[code])}
                  </button>
                ))}
              </div>
              {values.symptoms.map((symptom, index) => (
                <article key={`${symptom.code}-${index}`} className="flex flex-col gap-3 rounded-xl border border-line p-3">
                  <h2>{label(locale, symptomLabels[symptom.code])}</h2>
                  {symptom.code === 'other' ? (
                    <Field id={`symptoms.${index}.customLabel`} label={t(locale, 'otherLabel')} error={errorFor(`symptoms.${index}.customLabel`)}>
                      <input
                        id={`symptoms.${index}.customLabel`}
                        value={symptom.customLabel}
                        onChange={(event) => updateSymptom(form, index, { ...symptom, customLabel: event.target.value })}
                        className="min-h-11 rounded-xl border border-line bg-canvas px-3"
                      />
                    </Field>
                  ) : null}
                  <Score
                    labelText={t(locale, 'severity')}
                    value={symptom.severity}
                    min={0}
                    max={10}
                    skip={symptom.severitySkip}
                    onChange={(value) => updateSymptom(form, index, { ...symptom, severity: value })}
                    onSkip={(value) => updateSymptom(form, index, { ...symptom, severitySkip: value })}
                    locale={locale}
                  />
                  <ChoiceButtons locale={locale} labelText={t(locale, 'onset')} value={symptom.onset} onChange={(value) => updateSymptom(form, index, { ...symptom, onset: value })} options={options(onsetLabels)} />
                  <ChoiceButtons locale={locale} labelText={t(locale, 'persistence')} value={symptom.persistence} onChange={(value) => updateSymptom(form, index, { ...symptom, persistence: value })} options={options(persistenceLabels)} />
                  <ChoiceButtons locale={locale} labelText={t(locale, 'impact')} value={symptom.impact} onChange={(value) => updateSymptom(form, index, { ...symptom, impact: value })} options={options(impactLabels)} />
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      setUndo(symptom)
                      form.setValue(
                        'symptoms',
                        values.symptoms.filter((_, item) => item !== index),
                      )
                      window.setTimeout(() => setUndo(null), 5000)
                    }}
                  >
                    {t(locale, 'removeSymptom')}
                  </Button>
                </article>
              ))}
            </>
          ) : null}
          {undo ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                form.setValue('symptoms', [...form.getValues().symptoms, undo])
                setUndo(null)
              }}
            >
              {t(locale, 'undo')}
            </Button>
          ) : null}
          <ChoiceButtons
            locale={locale}
            labelText={t(locale, 'reviewAsk')}
            value={values.reviewRequested === null ? null : values.reviewRequested ? 'yes' : 'no'}
            onChange={(value) => form.setValue('reviewRequested', value === 'yes')}
            options={[
              { value: 'yes', label: { ru: 'Да', en: 'Yes' } },
              { value: 'no', label: { ru: 'Нет', en: 'No' } },
            ]}
          />
          <p className="text-sm text-muted">{t(locale, 'reviewHint')}</p>
        </section>
      ) : null}

      {step === 'personal' ? (
        <PersonalStep
          form={form}
          values={values}
          locale={locale}
          errorFor={errorFor}
          careOrders={careOrders}
          careBusyId={careBusyId}
          careMessage={careMessage}
          onCareRespond={(order, decision, note) => void respondPersonalCare(order, decision, note)}
          onConfigure={() => {
            setSectionEnabled(personalEnabled)
            setSectionSharing(profile.sensitive_sharing)
            setSettingsOpen(true)
          }}
        />
      ) : null}

      {step === 'measurements' ? (
        <OptionalGate
          locale={locale}
          title={t(locale, 'measurementsStep')}
          lead={t(locale, 'measurementsOptional')}
          choice={measureChoice}
          onFill={() => setMeasureChoice('fill')}
          onSkip={() => {
            setMeasureChoice('skip')
            form.setValue('measurementIds', [])
          }}
        >
          {measurements.length === 0 ? <p className="text-muted">{t(locale, 'noMeasurement')}</p> : null}
          <div className="flex flex-col gap-2">
            {measurements.map((measurement) => (
              <label key={measurement.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
                <input
                  type="checkbox"
                  checked={values.measurementIds.includes(measurement.id)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...values.measurementIds, measurement.id]
                      : values.measurementIds.filter((id) => id !== measurement.id)
                    form.setValue('measurementIds', next)
                  }}
                />
                <span>
                  {t(locale, 'attach')} · {measurement.metric} · <span className="numeric">{measurement.value ?? '—'}</span> · {measurement.source} · {measurement.quality}
                </span>
              </label>
            ))}
          </div>
          <Link className="inline-flex min-h-11 items-center text-accent" to="/onboard/measurements">
            {t(locale, 'newMeasurement')}
          </Link>
        </OptionalGate>
      ) : null}

      {step === 'review' ? (
        <section className="flex flex-col gap-4">
          {draft?.intent === 'revise' ? (
            <Field id="reason" label={t(locale, 'reason')}>
              <input
                id="reason"
                maxLength={300}
                value={draft.reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                className="min-h-11 rounded-xl border border-line bg-canvas px-3"
              />
            </Field>
          ) : null}
          <div>
            <h2 className="text-xl">{t(locale, 'reviewSections')}</h2>
            <div className="mt-2">
              <ReviewLine
                label={t(locale, 'recordType')}
                value={isChange ? t(locale, 'change') : t(locale, 'daily')}
              />
              <ReviewLine
                label={t(locale, 'overall')}
                value={values.overallState ? label(locale, overallLabels[values.overallState]) : t(locale, 'answerNone')}
              />
              <ReviewLine label={t(locale, 'reviewSleep')} value={sleepReviewLabel(locale, values, isChange, timeZone)} />
              <ReviewLine label={t(locale, 'reviewNutrition')} value={nutritionReviewLabel(locale, values, isChange)} />
              <Link className="inline-flex min-h-11 items-center text-accent" to="/onboard/activity">
                {t(locale, 'activityAdd')}
              </Link>
              <ReviewLine label={t(locale, 'reviewFatigue')} value={scoreReviewLabel(locale, values.fatigue, values.fatigueSkip)} />
              <ReviewLine label={t(locale, 'reviewStress')} value={scoreReviewLabel(locale, values.stress, values.stressSkip)} />
              <ReviewLine label={t(locale, 'reviewSymptoms')} value={symptomReviewLabel(locale, values)} />
              <ReviewLine
                label={t(locale, 'reviewPersonal')}
                value={personalLine(locale, personalEnabled, values.personalFill, values.personalSharing, share)}
              />
              <ReviewLine
                label={t(locale, 'reviewMeasurements')}
                value={
                  values.measurementIds.length > 0
                    ? t(locale, 'measurementsCount', { count: values.measurementIds.length })
                    : t(locale, 'measurementsNone')
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
            <p>{t(locale, 'generalDelivery')}: {share ? t(locale, 'assignedDoctor') : t(locale, 'deviceOnly')}</p>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />
              {t(locale, 'exchange')}
            </label>
            {personalEnabled && values.personalSharing === 'assigned_doctor' && !share ? (
              <p className="text-sm text-attention">{t(locale, 'personalNeedsGeneral')}</p>
            ) : null}
            <p className="text-sm text-muted">{t(locale, 'exchangeHint')}</p>
            <p className="text-sm">
              {t(locale, 'linkState')}: {session.connection === 'online' ? t(locale, 'linkUp') : t(locale, 'linkDown')}
            </p>
          </div>
          <button type="button" className="min-h-11 text-left text-accent" onClick={() => setStep('general')}>
            {t(locale, 'edit')}
          </button>
        </section>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 flex flex-wrap items-center gap-2 border-t border-line bg-canvas p-3">
        {step === 'general' ? (
          <p className="mr-auto text-sm text-muted">{t(locale, 'autoSaveDraft')}</p>
        ) : (
          <Button type="button" variant="quiet" onClick={() => go(steps[steps.indexOf(step) - 1] ?? 'general')}>
            {t(locale, 'back')}
          </Button>
        )}
        {step !== 'general' ? (
          <Button type="button" variant="secondary" onClick={() => navigate('/onboard/today')}>
            {t(locale, 'saveDraftExit')}
          </Button>
        ) : null}
        {step === 'review' ? (
          <Button type="submit" disabled={saving}>
            {t(locale, 'saveRecord')}
          </Button>
        ) : (
          <Button type="submit">{t(locale, 'continue')} →</Button>
        )}
      </div>

      <AppDialog open={prompt !== null} onOpenChange={() => setPrompt(null)} title={t(locale, 'draftChoice')} description={t(locale, 'localHint')}>
        <Button
          type="button"
          onClick={() => {
            if (prompt) openDraft(prompt)
            setPrompt(null)
          }}
        >
          {t(locale, 'continueDraft')}
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            if (!prompt || !profile) return
            void deleteDraft(db, { ownerId: profile.owner_id, environmentId }, prompt.id).then(async () => {
              const created = await createDraft(profile.owner_id, profile.timezone, params.get('mode') === 'change' ? 'change' : 'daily', params.get('revise'), profile.sensitive_sharing)
              if (created) {
                await saveDraft(db, created)
                openDraft(created)
              }
              setPrompt(null)
            })
          }}
        >
          {t(locale, 'deleteDraft')}
        </Button>
      </AppDialog>
      <AppDialog
        open={symptomPrompt !== null}
        onOpenChange={() => setSymptomPrompt(null)}
        title={t(locale, 'deleteSymptoms')}
        description={t(locale, 'deleteSymptoms')}
      >
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            form.setValue('symptoms', [])
            if (symptomPrompt) form.setValue('symptomPresence', symptomPrompt)
            setSymptomPrompt(null)
          }}
        >
          {t(locale, 'removeSymptom')}
        </Button>
        <Button type="button" variant="quiet" onClick={() => setSymptomPrompt(null)}>
          {t(locale, 'cancel')}
        </Button>
      </AppDialog>
      <AppDialog open={settingsOpen} onOpenChange={setSettingsOpen} title={t(locale, 'configureSection')} description={t(locale, 'personalHint')}>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={sectionEnabled} onChange={(event) => setSectionEnabled(event.target.checked)} />
          {t(locale, 'personalToggle')}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="section-sharing" checked={sectionSharing === 'device_only'} onChange={() => setSectionSharing('device_only')} />
          {t(locale, 'deviceOnly')}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="section-sharing" checked={sectionSharing === 'assigned_doctor'} onChange={() => setSectionSharing('assigned_doctor')} />
          {t(locale, 'assignedDoctor')}
        </label>
        <Button
          type="button"
          onClick={() => {
            const next = { ...profile, reproductive_enabled: sectionEnabled, sensitive_sharing: sectionSharing }
            setPersonalEnabled(sectionEnabled)
            void updateProfile(db, next).then(() => session.refreshLocal())
            form.setValue('personalSharing', sectionSharing)
            if (!sectionEnabled) setStep('symptoms')
            setSettingsOpen(false)
          }}
        >
          {t(locale, 'saveSettings')}
        </Button>
      </AppDialog>
      <AppDialog open={contactOpen} onOpenChange={setContactOpen} title={t(locale, 'contact')} description={t(locale, 'noEmergencyPromise')}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setContactOpen(false)
            navigate('/onboard/reports/new?reason=reply_to_doctor')
          }}
        >
          {t(locale, 'prepareMessage')}
        </Button>
        <Button
          type="button"
          onClick={() => {
            setProcedureOpen(true)
          }}
        >
          {t(locale, 'showProcedure')}
        </Button>
        <Button type="button" variant="quiet" onClick={() => setContactOpen(false)}>
          {t(locale, 'cancel')}
        </Button>
      </AppDialog>
      <AppDialog open={procedureOpen} onOpenChange={setProcedureOpen} title={t(locale, 'showProcedure')} description={procedureText || t(locale, 'procedureMissing')}>
        <Button type="button" variant="quiet" onClick={() => setProcedureOpen(false)}>
          {t(locale, 'close')}
        </Button>
      </AppDialog>
    </form>
  )
}

function stepKey(
  step: CheckinStep,
): 'generalStep' | 'sleepStep' | 'nutritionStep' | 'symptomsStep' | 'personalStep' | 'measurementsStep' | 'reviewStep' {
  if (step === 'sleep') return 'sleepStep'
  if (step === 'nutrition') return 'nutritionStep'
  if (step === 'symptoms') return 'symptomsStep'
  if (step === 'personal') return 'personalStep'
  if (step === 'measurements') return 'measurementsStep'
  if (step === 'review') return 'reviewStep'
  return 'generalStep'
}

function personalLine(
  locale: 'ru' | 'en',
  enabled: boolean,
  fill: CheckinDraftValues['personalFill'],
  sharing: CheckinDraftValues['personalSharing'],
  shareGeneral: boolean,
): string {
  if (!enabled) return t(locale, 'personalOff')
  if (fill !== 'yes') return t(locale, 'personalLater')
  if (sharing === 'assigned_doctor' && shareGeneral) return t(locale, 'assignedDoctor')
  if (sharing === 'assigned_doctor') return t(locale, 'personalNeedsGeneral')
  return t(locale, 'deviceOnly')
}

function options<T extends string>(map: Record<T, { ru: string; en: string }>) {
  return (Object.keys(map) as T[]).map((value) => ({ value, label: map[value] }))
}

function Score({
  labelText,
  value,
  min,
  max,
  onChange,
  skip,
  onSkip,
  locale,
  mode = 'buttons',
  minLabel,
  maxLabel,
}: {
  labelText: string
  value: number | null
  min: number
  max: number
  onChange: (value: number) => void
  skip: boolean
  onSkip: (value: boolean) => void
  locale: 'ru' | 'en'
  mode?: 'buttons' | 'slider'
  minLabel?: string
  maxLabel?: string
}) {
  const points = Array.from({ length: max - min + 1 }, (_, index) => min + index)
  if (mode === 'slider') {
    const shown = skip || value === null ? null : value
    return (
      <fieldset className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <legend className="text-sm">{labelText}</legend>
          <p className="numeric text-sm text-muted">
            {min}–{max}
          </p>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={shown ?? min}
          disabled={skip}
          aria-label={labelText}
          className={`h-2 w-full cursor-pointer accent-accent disabled:opacity-40 ${shown === null ? 'opacity-50' : ''}`}
          onChange={(event) => {
            onSkip(false)
            onChange(Number(event.target.value))
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>{minLabel ?? (min === 0 ? t(locale, 'scaleNone') : String(min))}</span>
          <span className="numeric text-ink">{shown === null ? t(locale, 'answerNone') : `${shown}/${max}`}</span>
          <span>{maxLabel ?? `${max} ${t(locale, 'scaleMax')}`}</span>
        </div>
        <button
          type="button"
          aria-pressed={skip}
          className={`min-h-11 self-start rounded-xl border px-3 ${skip ? 'border-accent text-accent' : 'border-line'}`}
          onClick={() => onSkip(true)}
        >
          {t(locale, 'cannotAssess')}
        </button>
        {shown === 0 ? <p className="text-sm text-muted">{t(locale, 'answerZero')}</p> : null}
      </fieldset>
    )
  }
  return (
    <fieldset>
      <legend className="mb-2 text-sm">{labelText}</legend>
      <div className="flex flex-wrap gap-2">
        {points.map((point) => (
          <button
            key={point}
            type="button"
            aria-pressed={!skip && value === point}
            className={`numeric min-h-11 min-w-11 rounded-xl border ${!skip && value === point ? 'border-accent text-accent' : 'border-line'}`}
            onClick={() => {
              onSkip(false)
              onChange(point)
            }}
          >
            {point}
          </button>
        ))}
        <button type="button" aria-pressed={skip} className={`min-h-11 rounded-xl border px-3 ${skip ? 'border-accent text-accent' : 'border-line'}`} onClick={() => onSkip(true)}>
          {t(locale, 'answerDeclined')}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {minLabel && maxLabel ? `${minLabel} · ${maxLabel} · ` : min === 0 ? `${t(locale, 'scaleNone')} · ${max} ${t(locale, 'scaleMax')} · ` : null}
        {skip
          ? t(locale, 'answerDeclined')
          : value === 0
            ? t(locale, 'answerZero')
            : value === null
              ? t(locale, 'answerNone')
              : null}
      </p>
    </fieldset>
  )
}

function applyChangePathDefaults(values: CheckinDraftValues): CheckinDraftValues {
  if (values.type !== 'change') return values
  return {
    ...values,
    sleepSkip: true,
    sleepHours: '',
    sleepQuality: null,
    sleepQualitySkip: true,
    sleepinessSkip: true,
    awakeningsSkip: true,
    sleepPlanDeviationSkip: true,
    sleepInterferingSkip: true,
    sleepInterfering: [],
    sleepDiscussSkip: true,
    sleepComment: '',
    sleepIntervals: [],
    sleepDurationSource: null,
    nutritionFill: 'not_applicable',
  }
}

function sleepReviewLabel(
  locale: 'ru' | 'en',
  values: CheckinDraftValues,
  isChange: boolean,
  timeZone: string,
): string {
  // Change path omits sleep entirely (not_applicable) — distinct from daily "I don't know".
  if (isChange) return t(locale, 'notApplicable')
  if (values.sleepSkip && values.sleepIntervals.length === 0) return t(locale, 'answerUnknown')
  const quality = values.sleepQualitySkip
    ? t(locale, 'answerDeclined')
    : values.sleepQuality === null
      ? t(locale, 'answerNone')
      : String(values.sleepQuality)
  const hoursLabel =
    values.sleepSkip || values.sleepHours.trim() === ''
      ? null
      : values.sleepHours.trim() === '0'
        ? t(locale, 'answerZero')
        : `${values.sleepHours} ${t(locale, 'hoursUnit')}`
  let base = hoursLabel
    ? `${hoursLabel} · ${t(locale, 'sleepQuality')}: ${quality}`
    : `${t(locale, 'answerUnknown')} · ${t(locale, 'sleepQuality')}: ${quality}`
  if (values.sleepIntervals.length > 0) {
    const domainIntervals: SleepInterval[] = values.sleepIntervals.flatMap((item) => {
      const start = zonedInputToDate(item.startLocal, timeZone)
      const end = zonedInputToDate(item.endLocal, timeZone)
      if (!start || !end) return []
      return [{ start_at: start.toISOString(), end_at: end.toISOString(), kind: item.kind, quality: item.quality }]
    })
    const total = sumSleptIntervalHours(domainIntervals)
    base += ` · ${t(locale, 'sleepIntervalsTitle')}: ${values.sleepIntervals.length}`
    if (values.sleepDurationSource) {
      base += ` · ${t(locale, 'sleepDurationSource')}: ${
        values.sleepDurationSource === 'overall' ? t(locale, 'sleep') : t(locale, 'sleepIntervalsSum')
      }`
    } else if (hoursLabel && total !== null) {
      base += ` · ${t(locale, 'sleepNoDoubleSum')}`
    }
  }
  return base
}

function nutritionReviewLabel(locale: 'ru' | 'en', values: CheckinDraftValues, isChange: boolean): string {
  if (isChange || values.nutritionFill === 'not_applicable') return t(locale, 'notApplicable')
  if (values.nutritionFill === 'skipped' || values.nutritionFill === null) return t(locale, 'answerSkipped')
  const period =
    values.nutritionPeriodStartLocal.trim() !== '' || values.nutritionPeriodEndLocal.trim() !== ''
      ? ` · ${t(locale, 'nutritionPeriodTitle')}`
      : ''
  if (values.fluidSkip) return `${t(locale, 'fillSection')}${period} · ${t(locale, 'fluidNotTracked')}`
  if (values.fluidRaw.trim() === '') return `${t(locale, 'fillSection')}${period}`
  const volume = values.fluidRaw.trim() === '0' ? t(locale, 'fluidZeroAnswer') : `${values.fluidRaw} mL`
  const completeness =
    values.fluidCompleteness === null
      ? t(locale, 'fluidCompletenessRequired')
      : values.fluidCompleteness === 'full'
        ? locale === 'ru'
          ? 'полный учёт'
          : 'complete'
        : values.fluidCompleteness === 'partial'
          ? locale === 'ru'
            ? 'частичный учёт'
            : 'partial'
          : t(locale, 'answerUnknown')
  return `${t(locale, 'fillSection')}${period} · ${volume} · ${completeness}`
}

function scoreReviewLabel(locale: 'ru' | 'en', value: number | null, skip: boolean): string {
  if (skip) return t(locale, 'answerDeclined')
  if (value === null) return t(locale, 'answerNone')
  if (value === 0) return t(locale, 'answerZero')
  return String(value)
}

function symptomReviewLabel(locale: 'ru' | 'en', values: CheckinDraftValues): string {
  if (values.symptomPresence === 'declined') return t(locale, 'symptomsDeclined')
  if (values.symptomPresence === 'no') return t(locale, 'symptomsNone')
  if (values.symptomPresence === 'yes') return t(locale, 'symptomsCount', { count: values.symptoms.length })
  return t(locale, 'answerNone')
}

function ChoiceMulti({
  locale,
  values,
  onChange,
}: {
  locale: 'ru' | 'en'
  values: CheckinDraftValues['context']
  onChange: (values: CheckinDraftValues['context']) => void
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm">{t(locale, 'context')}</legend>
      <div className="flex flex-wrap gap-2">
        {options(contextLabels).map((option) => {
          const selected = values.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              className={`min-h-11 rounded-xl border px-3 ${selected ? 'border-accent text-accent' : 'border-line'}`}
              onClick={() => onChange(selected ? values.filter((item) => item !== option.value) : [...values, option.value])}
            >
              {label(locale, option.label)}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function updateSymptom(form: ReturnType<typeof useForm<CheckinDraftValues>>, index: number, next: SymptomDraft) {
  const symptoms = [...form.getValues().symptoms]
  symptoms[index] = next
  form.setValue('symptoms', symptoms)
}

async function createDraft(
  ownerId: string,
  timeZone: string,
  type: 'daily' | 'change',
  reviseId: string | null,
  sharing: SharingMode,
): Promise<DraftRecord | null> {
  const now = dateToZonedInput(new Date(), timeZone)
  if (!reviseId) {
    const checkinId = crypto.randomUUID()
    return {
      id: crypto.randomUUID(),
      owner_id: ownerId,
      environment_id: environmentId,
      kind: 'checkin',
      status: 'active',
      step: 'general',
      intent: 'create',
      checkin_id: checkinId,
      revision_id: crypto.randomUUID(),
      parent_revision_id: null,
      revision_no: 1,
      root_id: checkinId,
      reason: '',
      operation_id: null,
      values: applyChangePathDefaults(emptyCheckinDraft(type, now, sharing)),
      updated_at: new Date().toISOString(),
    }
  }
  const scope = { ownerId, environmentId }
  const checkin = await readCheckin(db, scope, reviseId)
  if (!checkin) return null
  const revisions = await readRevisions(db, scope, reviseId)
  const latest = revisions[revisions.length - 1]
  if (!latest) return null
  return {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    environment_id: environmentId,
    kind: 'checkin',
    status: 'active',
    step: 'general',
    intent: 'revise',
    checkin_id: checkin.id,
    revision_id: crypto.randomUUID(),
    parent_revision_id: latest.id,
    revision_no: latest.revision_no + 1,
    root_id: checkin.root_id,
    reason: '',
    operation_id: null,
    values: payloadToDraft(latest.general_payload, dateToZonedInput(new Date(checkin.recorded_at), timeZone), checkin.type),
    updated_at: new Date().toISOString(),
  }
}
