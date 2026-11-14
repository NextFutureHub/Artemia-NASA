import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { ChoiceButtons } from '../../components/Choices.tsx'
import { AppDialog, Banner, Button, Field } from '../../components/ui.tsx'
import { dateToZonedInput, formatZoned, localDateInZone, zonedInputToDate } from '../../domain/clock.ts'
import {
  buildGeneralPayload,
  emptyCheckinDraft,
  emptySymptom,
  isFilledLater,
  issuesForStep,
  payloadToDraft,
  type CheckinDraftValues,
  type CheckinStep,
  type SymptomDraft,
} from '../../domain/checkinDraft.ts'
import type { SymptomCode } from '../../domain/enums.ts'
import { db } from '../../data/local/db.ts'
import {
  commitCheckin,
  deleteDraft,
  ensureActiveCheckinDraft,
  listMeasurements,
  readActiveDraft,
  readCheckin,
  readRevisions,
  saveDraft,
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
import type { DraftRecord, LocalMeasurement } from '../../data/local/types.ts'

const STEPS: CheckinStep[] = ['general', 'symptoms', 'measurements', 'review']

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
  const [result, setResult] = useState<{ at: string; delivery: 'local_only' | 'queued' | 'on_server'; id: string } | null>(null)
  const [share, setShare] = useState(profile?.general_exchange ?? false)
  const [prompt, setPrompt] = useState<DraftRecord | null>(null)
  const [symptomPrompt, setSymptomPrompt] = useState<'no' | 'declined' | null>(null)
  const [undo, setUndo] = useState<SymptomDraft | null>(null)
  const [measurements, setMeasurements] = useState<LocalMeasurement[]>([])
  const [failure, setFailure] = useState('')
  const stepRef = useRef(step)
  stepRef.current = step
  const draftRef = useRef(draft)
  draftRef.current = draft
  const form = useForm<CheckinDraftValues>({ defaultValues: emptyCheckinDraft('daily', '') })
  const values = form.watch()

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
      const created = await createDraft(profile.owner_id, profile.timezone, params.get('mode') === 'change' ? 'change' : 'daily', reviseId)
      if (!created || cancelled) return
      const stored = await ensureActiveCheckinDraft(db, created)
      if (cancelled) return
      openDraft(stored)
    })()
    void listMeasurements(db, scope).then((rows) => {
      if (!cancelled) setMeasurements(rows)
    })
    return () => {
      cancelled = true
    }
  }, [profile?.owner_id])

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
    setDraft(next)
    setStep(next.step)
    form.reset(next.values)
    setSavedAt(next.updated_at)
  }

  if (!profile) return null
  const timeZone = profile.timezone
  const errorFor = (path: string) => {
    const issue = issues.find((item) => item.path === path)
    return issue ? issueText(locale, issue.message) : undefined
  }

  function go(next: CheckinStep) {
    const currentIssues = issuesForStep(step, form.getValues(), timeZone, new Date())
    if (STEPS.indexOf(next) > STEPS.indexOf(step) && currentIssues.length > 0) {
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

  async function onSave() {
    if (saving || !draft || !profile) return
    const now = new Date()
    const built = buildGeneralPayload(form.getValues(), timeZone, now)
    if (!built.payload) {
      setIssues(built.issues)
      document.getElementById(built.issues[0]?.path ?? '')?.focus()
      return
    }
    setSaving(true)
    setFailure('')
    const operationId = draft.operation_id ?? crypto.randomUUID()
    const recorded = zonedInputToDate(form.getValues().recordedAtLocal, timeZone) ?? now
    try {
      const status = await commitCheckin(db, { ownerId: profile.owner_id, environmentId }, draft.id, operationId, built.payload, share, {
        recordedAt: recorded.toISOString(),
        localDate: localDateInZone(recorded, timeZone),
      })
      if (status.status === 'committed') {
        setResult({ at: status.savedAt, delivery: status.delivery, id: status.entityId })
        await session.refreshLocal()
      } else {
        setFailure(t(locale, 'saveDeviceFailed'))
      }
    } catch {
      setFailure(t(locale, 'saveDeviceFailed'))
    } finally {
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
          <Button variant="secondary" disabled>
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

  return (
    <form
      className="flex flex-col gap-4 pb-24"
      onSubmit={(event) => {
        event.preventDefault()
        if (step === 'review') void onSave()
        else go(STEPS[STEPS.indexOf(step) + 1] ?? step)
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <ol className="flex flex-wrap gap-2 text-sm">
          {STEPS.map((item, index) => (
            <li key={item} className={item === step ? 'text-accent' : 'text-muted'}>
              {index + 1}. {t(locale, stepKey(item))}
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted">{t(locale, 'localHint')}</p>
      </div>
      {savedAt ? <p className="numeric text-sm text-muted">{t(locale, 'draftSaved', { time: formatZoned(new Date(savedAt), timeZone, locale === 'ru' ? 'ru' : 'en') })}</p> : null}
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
        <section className="flex flex-col gap-4">
          <Field id="recordedAtLocal" label={t(locale, 'recordedAt')} hint={timeZone} error={errorFor('recordedAtLocal')}>
            <input id="recordedAtLocal" type="datetime-local" className="min-h-11 rounded-xl border border-line bg-canvas px-3" {...form.register('recordedAtLocal')} />
          </Field>
          {later ? <p>{t(locale, 'filledLater')}</p> : null}
          <p className="text-sm text-muted">{t(locale, 'notATest')}</p>
          <ChoiceButtons locale={locale} labelText={t(locale, 'overall')} value={values.overallState} onChange={(value) => form.setValue('overallState', value)} options={options(overallLabels)} />
          <Field id="sleepHours" label={t(locale, 'sleep')} error={errorFor('sleepHours')}>
            <input id="sleepHours" inputMode="decimal" className="min-h-11 rounded-xl border border-line bg-canvas px-3" {...form.register('sleepHours')} />
          </Field>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={values.sleepSkip} onChange={(event) => form.setValue('sleepSkip', event.target.checked)} />
            {t(locale, 'sleepUnknown')}
          </label>
          <Score labelText={t(locale, 'sleepQuality')} value={values.sleepQuality} max={5} min={1} onChange={(value) => form.setValue('sleepQuality', value)} skip={values.sleepQualitySkip} onSkip={(value) => form.setValue('sleepQualitySkip', value)} locale={locale} />
          <Score labelText={t(locale, 'fatigue')} value={values.fatigue} max={10} min={0} onChange={(value) => form.setValue('fatigue', value)} skip={values.fatigueSkip} onSkip={(value) => form.setValue('fatigueSkip', value)} locale={locale} />
          <Score labelText={t(locale, 'stress')} value={values.stress} max={10} min={0} onChange={(value) => form.setValue('stress', value)} skip={values.stressSkip} onSkip={(value) => form.setValue('stressSkip', value)} locale={locale} />
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
        </section>
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

      {step === 'measurements' ? (
        <section className="flex flex-col gap-3">
          <p>{t(locale, 'measurementsOptional')}</p>
          {measurements.length === 0 ? <p className="text-muted">{t(locale, 'noMeasurement')}</p> : null}
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
          <Link className="inline-flex min-h-11 items-center" to="/onboard/measurements">
            {t(locale, 'newMeasurement')}
          </Link>
        </section>
      ) : null}

      {step === 'review' ? (
        <section className="flex flex-col gap-3">
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
          <p>{t(locale, 'overall')}: {values.overallState ? label(locale, overallLabels[values.overallState]) : '—'}</p>
          <p>{t(locale, 'generalDelivery')}: {share ? t(locale, 'assignedDoctor') : t(locale, 'deviceOnly')}</p>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />
            {t(locale, 'exchange')}
          </label>
          <p>
            {t(locale, 'personalDelivery')}: {profile.reproductive_enabled ? t(locale, 'personalLater') : t(locale, 'personalOff')}
          </p>
          <p>
            {t(locale, 'linkState')}: {session.connection === 'online' ? t(locale, 'linkUp') : t(locale, 'linkDown')}
          </p>
          <button type="button" className="min-h-11 text-left" onClick={() => setStep('general')}>
            {t(locale, 'edit')}
          </button>
        </section>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 flex flex-wrap gap-2 border-t border-line bg-canvas p-3">
        {step === 'general' ? (
          <Button type="button" variant="quiet" onClick={() => navigate('/onboard/today')}>
            {t(locale, 'cancel')}
          </Button>
        ) : (
          <Button type="button" variant="quiet" onClick={() => go(STEPS[STEPS.indexOf(step) - 1] ?? 'general')}>
            {t(locale, 'back')}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={() => navigate('/onboard/today')}>
          {t(locale, 'saveDraftExit')}
        </Button>
        {step === 'review' ? (
          <Button type="submit" disabled={saving}>
            {t(locale, 'saveRecord')}
          </Button>
        ) : (
          <Button type="submit">{t(locale, 'continue')}</Button>
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
              const created = await createDraft(profile.owner_id, profile.timezone, params.get('mode') === 'change' ? 'change' : 'daily', params.get('revise'))
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
    </form>
  )
}

function stepKey(step: CheckinStep): 'generalStep' | 'symptomsStep' | 'measurementsStep' | 'reviewStep' {
  if (step === 'symptoms') return 'symptomsStep'
  if (step === 'measurements') return 'measurementsStep'
  if (step === 'review') return 'reviewStep'
  return 'generalStep'
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
}: {
  labelText: string
  value: number | null
  min: number
  max: number
  onChange: (value: number) => void
  skip: boolean
  onSkip: (value: boolean) => void
  locale: 'ru' | 'en'
}) {
  const points = Array.from({ length: max - min + 1 }, (_, index) => min + index)
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
          {t(locale, 'skipRate')}
        </button>
      </div>
      {min === 0 ? (
        <p className="mt-1 text-sm text-muted">
          0 {t(locale, 'scaleNone')} · {max} {t(locale, 'scaleMax')}
        </p>
      ) : null}
    </fieldset>
  )
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

async function createDraft(ownerId: string, timeZone: string, type: 'daily' | 'change', reviseId: string | null): Promise<DraftRecord | null> {
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
      values: emptyCheckinDraft(type, now),
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
