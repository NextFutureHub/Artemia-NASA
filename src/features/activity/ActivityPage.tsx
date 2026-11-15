import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { ChoiceButtons } from '../../components/Choices.tsx'
import { OptionalGate, PageIntro } from '../../components/FormChrome.tsx'
import { Banner, Button, Field } from '../../components/ui.tsx'
import { dateToZonedInput, zonedInputToDate } from '../../domain/clock.ts'
import {
  buildActivityPayload,
  linkActivityToCareOrder,
  type ActivityCompletion,
  type ActivitySkipReason,
  type ActivityType,
} from '../../domain/activityPayload.ts'
import { commitActivity } from '../../data/local/activities.ts'
import { listCareOrders } from '../../data/local/careOrders.ts'
import { db } from '../../data/local/db.ts'
import { environmentId } from '../../data/remote/client.ts'
import { issueText, t } from '../../i18n/copy.ts'
import type { LocalCareOrder } from '../../data/local/types.ts'

type FormState = {
  startedAtLocal: string
  activityType: ActivityType | null
  modality: string
  completion: ActivityCompletion | null
  skipReason: ActivitySkipReason | null
  actualDurationMin: string
  exertion: number | null
  exertionSkip: boolean
  comment: string
}

/**
 * Activity / workout entry wired to domain buildActivityPayload (E09–E11)
 * and IndexedDB commitActivity (local journal + care_order_response link).
 */
export function ActivityPage() {
  const session = useSession()
  const locale = session.locale
  const profile = session.profile
  const [params] = useSearchParams()
  const taskId = params.get('task')
  const [orders, setOrders] = useState<LocalCareOrder[]>([])
  const [pathChoice, setPathChoice] = useState<'fill' | 'skip' | null>(null)
  const [notice, setNotice] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  const [builtId, setBuiltId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deliveryHint, setDeliveryHint] = useState<'local_only' | 'queued' | null>(null)

  const linked = useMemo(() => orders.find((row) => row.id === taskId) ?? null, [orders, taskId])
  const fromTask = Boolean(linked)
  const plannedDurationMin = linked ? parsePlannedMinutes(linked.schedule_text) : null

  const [values, setValues] = useState<FormState>({
    startedAtLocal: '',
    activityType: null,
    modality: '',
    completion: null,
    skipReason: null,
    actualDurationMin: '',
    exertion: null,
    exertionSkip: false,
    comment: '',
  })

  useEffect(() => {
    if (!profile) return
    void listCareOrders(db, { ownerId: profile.owner_id, environmentId }).then(setOrders)
  }, [profile?.owner_id])

  useEffect(() => {
    if (!profile) return
    setValues({
      startedAtLocal: dateToZonedInput(new Date(), profile.timezone),
      activityType: null,
      modality: '',
      completion: null,
      skipReason: null,
      actualDurationMin: '',
      exertion: null,
      exertionSkip: false,
      comment: '',
    })
    setPathChoice(null)
    setNotice('')
    setIssues([])
    setBuiltId(null)
    setDeliveryHint(null)
  }, [profile?.timezone, linked?.id])

  if (!profile) return null

  function patch(partial: Partial<FormState>) {
    setValues((current) => ({ ...current, ...partial }))
  }

  function onCompletion(completion: ActivityCompletion) {
    if (completion === 'skipped') {
      patch({
        completion,
        actualDurationMin: '0',
        exertion: null,
        exertionSkip: true,
        skipReason: values.skipReason,
      })
      return
    }
    patch({
      completion,
      exertionSkip: false,
      skipReason: null,
      actualDurationMin: values.actualDurationMin === '0' ? '' : values.actualDurationMin,
    })
  }

  async function submit() {
    if (saving) return
    if (!profile || !session.mission) {
      setIssues(['required'])
      return
    }
    const started = zonedInputToDate(values.startedAtLocal, profile.timezone)
    if (!started || values.activityType === null || values.completion === null) {
      setIssues(['required'])
      return
    }
    if (values.completion === 'skipped' && !fromTask) {
      setIssues(['standalone_skip_needs_plan'])
      return
    }
    const id = crypto.randomUUID()
    const built = buildActivityPayload({
      id,
      missionId: session.mission.mission_id,
      startedAt: started.toISOString(),
      activityType: values.activityType,
      completion: values.completion,
      plannedDurationMin: fromTask ? plannedDurationMin : null,
      actualDurationMin: values.completion === 'skipped' ? 0 : Number(values.actualDurationMin),
      skipReason: values.completion === 'skipped' ? values.skipReason : null,
      exertion: values.completion === 'skipped' ? null : values.exertion,
      exertionDeclined: values.completion !== 'skipped' && values.exertionSkip,
      careOrderId: fromTask && linked ? linked.id : null,
      measurementIds: [],
      comment: values.comment.trim() === '' ? null : values.comment.trim(),
    })
    if (!built.payload) {
      setIssues(built.issues)
      return
    }
    if (built.payload.care_order_id) {
      linkActivityToCareOrder(built.payload.id, built.payload.care_order_id)
    }
    setSaving(true)
    setIssues([])
    try {
      const status = await commitActivity(
        db,
        { ownerId: profile.owner_id, environmentId },
        {
          operationId: crypto.randomUUID(),
          payload: built.payload,
          careOrder: fromTask && linked ? linked : null,
          responseOperationId: built.payload.care_order_id ? crypto.randomUUID() : undefined,
        },
      )
      if (status.status === 'committed') {
        setBuiltId(status.entityId)
        setDeliveryHint(status.careResponseQueued ? 'queued' : 'local_only')
        setNotice(t(locale, 'activitySaved'))
        await session.refreshLocal()
        if (fromTask) {
          setOrders(await listCareOrders(db, { ownerId: profile.owner_id, environmentId }))
        }
      } else if (status.status === 'conflict') {
        setIssues(['conflict'])
      } else {
        setIssues([status.reason])
      }
    } catch {
      setIssues(['save_failed'])
    } finally {
      setSaving(false)
    }
  }

  const happened = values.completion === 'full' || values.completion === 'partial'
  const skipNeedsPlan = values.completion === 'skipped' && !fromTask

  return (
    <div className="flex flex-col gap-4">
      <PageIntro title={t(locale, 'activityTitle')} subtitle={t(locale, 'activitySubtitle')} />

      {fromTask && linked ? (
        <Banner tone="neutral">
          {t(locale, 'activityFromTask')}: {linked.title}
          {plannedDurationMin !== null
            ? ` · ${t(locale, 'activityPlannedDuration')}: ${plannedDurationMin} ${t(locale, 'minutesUnit')}`
            : ''}
        </Banner>
      ) : (
        <Banner tone="neutral">{t(locale, 'activityStandaloneHint')}</Banner>
      )}

      {!fromTask && taskId ? <Banner tone="attention">{t(locale, 'activityTaskMissing')}</Banner> : null}

      <OptionalGate
        locale={locale}
        title={t(locale, 'activitySessionGate')}
        lead={t(locale, 'activitySessionGateLead')}
        choice={pathChoice}
        onFill={() => setPathChoice('fill')}
        onSkip={() => {
          setPathChoice('skip')
          onCompletion('skipped')
        }}
      >
        {pathChoice === 'fill' ? (
          <div className="flex flex-col gap-4">
            <Field id="activity-started" label={t(locale, 'activityStartedAt')}>
              <input
                id="activity-started"
                type="datetime-local"
                className="min-h-11 rounded-xl border border-line bg-canvas px-3"
                value={values.startedAtLocal}
                onChange={(event) => patch({ startedAtLocal: event.target.value })}
              />
            </Field>

            <ChoiceButtons
              locale={locale}
              labelText={t(locale, 'activityKind')}
              value={values.activityType}
              onChange={(value) => patch({ activityType: value })}
              options={[
                { value: 'aerobic', label: { ru: 'Аэробная', en: 'Aerobic' } },
                { value: 'strength', label: { ru: 'Силовая', en: 'Strength' } },
                { value: 'other', label: { ru: 'Другая', en: 'Other' } },
              ]}
            />

            <Field id="activity-modality" label={t(locale, 'activityModality')}>
              <input
                id="activity-modality"
                maxLength={100}
                className="min-h-11 rounded-xl border border-line bg-canvas px-3"
                value={values.modality}
                onChange={(event) => patch({ modality: event.target.value })}
              />
            </Field>

            <ChoiceButtons
              locale={locale}
              labelText={t(locale, 'activityCompletion')}
              value={values.completion}
              onChange={onCompletion}
              options={[
                { value: 'full', label: { ru: 'Полностью', en: 'Fully' } },
                { value: 'partial', label: { ru: 'Частично', en: 'Partially' } },
                { value: 'skipped', label: { ru: 'Пропущено', en: 'Skipped' } },
              ]}
            />

            {skipNeedsPlan ? <Banner tone="attention">{t(locale, 'activitySkipNeedsPlan')}</Banner> : null}

            {values.completion === 'partial' || values.completion === 'skipped' ? (
              <ChoiceButtons
                locale={locale}
                labelText={t(locale, 'activityDeviation')}
                value={values.skipReason}
                onChange={(value) => patch({ skipReason: value })}
                options={[
                  { value: 'no_time', label: { ru: 'Нет времени', en: 'No time' } },
                  { value: 'no_equipment', label: { ru: 'Нет оборудования', en: 'No equipment' } },
                  { value: 'wellbeing', label: { ru: 'Самочувствие', en: 'How I feel' } },
                  { value: 'other', label: { ru: 'Другое', en: 'Other' } },
                  { value: 'declined', label: { ru: 'Не хочу указывать', en: 'Prefer not to say' } },
                ]}
              />
            ) : null}

            {happened ? (
              <>
                <Field id="activity-duration" label={t(locale, 'activityActualDuration')}>
                  <input
                    id="activity-duration"
                    inputMode="numeric"
                    className="min-h-11 rounded-xl border border-line bg-canvas px-3"
                    value={values.actualDurationMin}
                    onChange={(event) => patch({ actualDurationMin: event.target.value })}
                  />
                </Field>

                <fieldset>
                  <legend className="mb-2 text-sm">{t(locale, 'activityExertion')}</legend>
                  <label className="mb-2 flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={values.exertionSkip}
                      onChange={(event) =>
                        patch({
                          exertionSkip: event.target.checked,
                          exertion: event.target.checked ? null : values.exertion,
                        })
                      }
                    />
                    {t(locale, 'skipRate')}
                  </label>
                  {!values.exertionSkip ? (
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 11 }, (_, score) => (
                        <button
                          key={score}
                          type="button"
                          aria-pressed={values.exertion === score}
                          className={`min-h-11 min-w-11 rounded-xl border px-3 ${values.exertion === score ? 'border-accent text-accent' : 'border-line'}`}
                          onClick={() => patch({ exertion: score })}
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </fieldset>
              </>
            ) : values.completion === 'skipped' ? (
              <p className="text-sm text-muted">{t(locale, 'activitySkipNoLoad')}</p>
            ) : null}

            <Field id="activity-comment" label={t(locale, 'comment')} hint={`${values.comment.length}/1000`}>
              <textarea
                id="activity-comment"
                maxLength={1000}
                className="min-h-20 rounded-xl border border-line bg-canvas px-3 py-2"
                value={values.comment}
                onChange={(event) => patch({ comment: event.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </OptionalGate>

      {pathChoice === 'skip' ? (
        <div className="flex flex-col gap-3">
          {skipNeedsPlan ? <Banner tone="attention">{t(locale, 'activitySkipNeedsPlan')}</Banner> : null}
          <ChoiceButtons
            locale={locale}
            labelText={t(locale, 'activityKind')}
            value={values.activityType}
            onChange={(value) =>
              patch({
                activityType: value,
                completion: 'skipped',
                actualDurationMin: '0',
                exertion: null,
                exertionSkip: true,
              })
            }
            options={[
              { value: 'aerobic', label: { ru: 'Аэробная', en: 'Aerobic' } },
              { value: 'strength', label: { ru: 'Силовая', en: 'Strength' } },
              { value: 'other', label: { ru: 'Другая', en: 'Other' } },
            ]}
          />
          <ChoiceButtons
            locale={locale}
            labelText={t(locale, 'activityDeviation')}
            value={values.skipReason}
            onChange={(value) =>
              patch({
                skipReason: value,
                completion: 'skipped',
                actualDurationMin: '0',
                exertion: null,
                exertionSkip: true,
              })
            }
            options={[
              { value: 'no_time', label: { ru: 'Нет времени', en: 'No time' } },
              { value: 'no_equipment', label: { ru: 'Нет оборудования', en: 'No equipment' } },
              { value: 'wellbeing', label: { ru: 'Самочувствие', en: 'How I feel' } },
              { value: 'other', label: { ru: 'Другое', en: 'Other' } },
              { value: 'declined', label: { ru: 'Не хочу указывать', en: 'Prefer not to say' } },
            ]}
          />
          <p className="text-sm text-muted">{t(locale, 'activitySkipNoLoad')}</p>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <Banner tone="danger">
          <ul className="list-disc pl-5">
            {issues.map((issue) => (
              <li key={issue}>
                {issue === 'standalone_skip_needs_plan'
                  ? t(locale, 'activitySkipNeedsPlan')
                  : issue === 'save_failed'
                    ? t(locale, 'saveDeviceFailed')
                    : issueText(locale, issue)}
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {notice ? (
        <Banner tone="neutral">
          {notice}
          {builtId ? ` · id ${builtId.slice(0, 8)}` : ''}
          {deliveryHint === 'queued' ? ` · ${t(locale, 'waitingSend')}` : null}
          {deliveryHint === 'local_only' ? ` · ${t(locale, 'storedLocally')}` : null}
        </Banner>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pathChoice === null || saving}
          onClick={() => {
            if (pathChoice === 'skip') {
              patch({ completion: 'skipped', actualDurationMin: '0', exertion: null, exertionSkip: true })
            }
            void submit()
          }}
        >
          {t(locale, 'activitySave')}
        </Button>
        <Link className="inline-flex min-h-11 items-center text-accent" to="/onboard/today">
          {t(locale, 'backToday')}
        </Link>
        {fromTask ? (
          <Link className="inline-flex min-h-11 items-center text-accent" to="/onboard/orders">
            {t(locale, 'careOpenAll')}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

function parsePlannedMinutes(scheduleText: string): number | null {
  const match = scheduleText.match(/(\d+)\s*(min|мин)/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}
