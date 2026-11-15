import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { ChoiceButtons } from '../../components/Choices.tsx'
import { OptionalGate } from '../../components/FormChrome.tsx'
import { Banner, Button, Field } from '../../components/ui.tsx'
import type { CheckinDraftValues } from '../../domain/checkinDraft.ts'
import { isPersonalCareTask } from '../../domain/careTaskPrivacy.ts'
import type { CareOrderDecision, SharingMode } from '../../domain/enums.ts'
import { careKindLabel } from '../../domain/labels.ts'
import type { LocalCareOrder } from '../../data/local/types.ts'
import { label, t, type Locale } from '../../i18n/copy.ts'

export function PersonalStep({
  form,
  values,
  locale,
  errorFor,
  onConfigure,
  careOrders,
  careBusyId,
  careMessage,
  onCareRespond,
}: {
  form: UseFormReturn<CheckinDraftValues>
  values: CheckinDraftValues
  locale: Locale
  errorFor: (path: string) => string | undefined
  onConfigure: () => void
  careOrders: LocalCareOrder[]
  careBusyId: string | null
  careMessage: string
  onCareRespond: (order: LocalCareOrder, decision: CareOrderDecision, note: string) => void
}) {
  const bleedingPresent = values.bleeding === 'spotting' || values.bleeding === 'menstrual' || values.bleeding === 'other'
  const adherenceVisible = values.cycleContext === 'suppression_regimen'
  const choice = values.personalFill === 'yes' ? 'fill' : values.personalFill === 'skip' ? 'skip' : null
  const personalOrders = careOrders.filter((order) => order.status === 'active' && isPersonalCareTask(order))
  const [openId, setOpenId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl">{t(locale, 'personalTitle')}</h2>
        <p className="text-muted">{t(locale, 'personalLead')}</p>
        <button type="button" className="min-h-11 text-left text-accent" onClick={onConfigure}>
          {t(locale, 'configureSection')}
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
        <div>
          <h3 className="text-xl">{t(locale, 'personalCarePlan')}</h3>
          <p className="mt-1 text-sm text-muted">{t(locale, 'personalCarePlanLead')}</p>
        </div>
        <Banner tone="neutral">{t(locale, 'careOrdersSubtitle')}</Banner>
        {careMessage ? <Banner tone="neutral">{careMessage}</Banner> : null}
        {personalOrders.length === 0 ? <p className="text-sm text-muted">{t(locale, 'personalCareEmpty')}</p> : null}
        <ul className="flex flex-col gap-3">
          {personalOrders.map((order) => {
            const collapsed = order.kind === 'symptom_monitor' && openId !== order.id
            return (
              <li key={order.id} className="rounded-xl border border-line bg-canvas p-3">
                <p className="font-medium">{collapsed ? t(locale, 'personalTask') : order.title}</p>
                <p className="text-sm text-muted">{careKindLabel(locale, order.kind)}</p>
                {collapsed ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-sm text-muted">{t(locale, 'personalTaskHint')}</p>
                    <Button type="button" variant="secondary" onClick={() => setOpenId(order.id)}>
                      {t(locale, 'careOpenTask')}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {order.goal ? (
                      <p className="text-sm">
                        {t(locale, 'careGoal')}: {order.goal}
                      </p>
                    ) : null}
                    <p>{order.instructions}</p>
                    {order.schedule_text ? (
                      <p className="text-sm">
                        {t(locale, 'careSchedule')}: {order.schedule_text}
                      </p>
                    ) : null}
                    {order.ack_required ? <Banner tone="attention">{t(locale, 'careAckNeeded')}</Banner> : null}
                    <Field id={`personal-care-note-${order.id}`} label={t(locale, 'careNote')}>
                      <textarea
                        id={`personal-care-note-${order.id}`}
                        maxLength={1000}
                        className="min-h-20 rounded-xl border border-line bg-canvas px-3 py-2"
                        value={notes[order.id] ?? ''}
                        onChange={(event) => setNotes((current) => ({ ...current, [order.id]: event.target.value }))}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      {order.ack_required ? (
                        <Button
                          type="button"
                          disabled={careBusyId === order.id}
                          onClick={() => onCareRespond(order, 'acknowledged', notes[order.id] ?? '')}
                        >
                          {t(locale, 'careAcknowledge')}
                        </Button>
                      ) : null}
                      <Button type="button" disabled={careBusyId === order.id} onClick={() => onCareRespond(order, 'done', notes[order.id] ?? '')}>
                        {t(locale, 'careMarkDone')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={careBusyId === order.id}
                        onClick={() => onCareRespond(order, 'skipped', notes[order.id] ?? '')}
                      >
                        {t(locale, 'careMarkSkip')}
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        disabled={careBusyId === order.id}
                        onClick={() => onCareRespond(order, 'unable', notes[order.id] ?? '')}
                      >
                        {t(locale, 'careMarkUnable')}
                      </Button>
                    </div>
                    <p className="text-sm text-muted">{t(locale, 'careUnableHint')}</p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <OptionalGate
        locale={locale}
        title={t(locale, 'fillToday')}
        lead={t(locale, 'personalLead')}
        choice={choice}
        onFill={() => form.setValue('personalFill', 'yes')}
        onSkip={() => form.setValue('personalFill', 'skip')}
      >
        {errorFor('personalFill') ? <p className="text-sm text-danger">{errorFor('personalFill')}</p> : null}
        <ChoiceButtons
          locale={locale}
          labelText={t(locale, 'bleeding')}
          value={values.bleeding}
          onChange={(value) => form.setValue('bleeding', value)}
          options={[
            { value: 'none', label: { ru: 'Нет', en: 'No' } },
            { value: 'spotting', label: { ru: 'Мажущие', en: 'Spotting' } },
            { value: 'menstrual', label: { ru: 'Менструальные', en: 'Menstrual' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other' } },
            { value: 'unsure', label: { ru: 'Не уверена(ен)', en: 'Not sure' } },
            { value: 'declined', label: { ru: 'Не хочу отвечать', en: 'I do not want to answer' } },
          ]}
        />
        {bleedingPresent ? (
          <fieldset>
            <legend className="mb-2 text-sm">{t(locale, 'intensity')}</legend>
            <div className="flex flex-wrap gap-2">
              {(['light', 'moderate', 'heavy', 'cannot_assess'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={!values.intensitySkip && values.intensity === value}
                  className={`min-h-11 rounded-xl border px-3 ${!values.intensitySkip && values.intensity === value ? 'border-accent text-accent' : 'border-line'}`}
                  onClick={() => {
                    form.setValue('intensitySkip', false)
                    form.setValue('intensity', value)
                  }}
                >
                  {label(locale, intensityLabel[value])}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={values.intensitySkip}
                className={`min-h-11 rounded-xl border px-3 ${values.intensitySkip ? 'border-accent text-accent' : 'border-line'}`}
                onClick={() => form.setValue('intensitySkip', true)}
              >
                {t(locale, 'doNotRate')}
              </button>
            </div>
          </fieldset>
        ) : null}
        <ChoiceButtons
          locale={locale}
          labelText={t(locale, 'expected')}
          value={values.expectedness}
          onChange={(value) => form.setValue('expectedness', value)}
          options={[
            { value: 'yes', label: { ru: 'Да', en: 'Yes' } },
            { value: 'no', label: { ru: 'Нет', en: 'No' } },
            { value: 'unknown', label: { ru: 'Не знаю', en: 'I do not know' } },
            { value: 'declined', label: { ru: 'Не хочу отвечать', en: 'I do not want to answer' } },
          ]}
        />
        <fieldset>
          <legend className="mb-2 text-sm">{t(locale, 'discomfort')}</legend>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 11 }, (_, point) => (
              <button
                key={point}
                type="button"
                aria-pressed={!values.discomfortSkip && values.discomfort === point}
                className={`numeric min-h-11 min-w-11 rounded-xl border ${!values.discomfortSkip && values.discomfort === point ? 'border-accent text-accent' : 'border-line'}`}
                onClick={() => {
                  form.setValue('discomfortSkip', false)
                  form.setValue('discomfort', point)
                }}
              >
                {point}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={values.discomfortSkip}
              className={`min-h-11 rounded-xl border px-3 ${values.discomfortSkip ? 'border-accent text-accent' : 'border-line'}`}
              onClick={() => form.setValue('discomfortSkip', true)}
            >
              {t(locale, 'doNotRate')}
            </button>
          </div>
          <p className="mt-1 text-sm text-muted">
            {values.discomfortSkip
              ? t(locale, 'answerDeclined')
              : values.discomfort === 0
                ? t(locale, 'answerZero')
                : values.discomfort === null
                  ? t(locale, 'answerNone')
                  : null}
          </p>
        </fieldset>
        <ChoiceButtons
          locale={locale}
          labelText={t(locale, 'impact')}
          value={values.activityImpact}
          onChange={(value) => form.setValue('activityImpact', value)}
          options={[
            { value: 'none', label: { ru: 'Не влияет', en: 'No effect' } },
            { value: 'some', label: { ru: 'Немного', en: 'Some effect' } },
            { value: 'severe', label: { ru: 'Сильно', en: 'A strong effect' } },
            { value: 'cannot_assess', label: { ru: 'Не оценивать', en: 'Do not rate' } },
          ]}
        />
        <ChoiceButtons
          locale={locale}
          labelText={t(locale, 'cycleContext')}
          value={values.cycleContext}
          onChange={(value) => form.setValue('cycleContext', value)}
          options={[
            { value: 'natural', label: { ru: 'Естественный цикл', en: 'Natural cycle' } },
            { value: 'suppression_regimen', label: { ru: 'Использую назначенную схему подавления менструации', en: 'Using a prescribed menstrual suppression regimen' } },
            { value: 'other', label: { ru: 'Другой контекст', en: 'Another context' } },
            { value: 'declined', label: { ru: 'Не хочу отвечать', en: 'I do not want to answer' } },
          ]}
        />
        {adherenceVisible ? (
          <>
            <ChoiceButtons
              locale={locale}
              labelText={t(locale, 'adherence')}
              value={values.adherence}
              onChange={(value) => form.setValue('adherence', value)}
              options={[
                { value: 'on_plan', label: { ru: 'По плану', en: 'On plan' } },
                { value: 'missed_or_changed', label: { ru: 'Был пропуск или изменение', en: 'There was a missed dose or a change' } },
                { value: 'declined', label: { ru: 'Не хочу отвечать', en: 'I do not want to answer' } },
              ]}
            />
            <p className="text-sm text-muted">{t(locale, 'adherenceHint')}</p>
          </>
        ) : null}
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={values.personalReview} onChange={(event) => form.setValue('personalReview', event.target.checked)} />
          {t(locale, 'discussDoctor')}
        </label>
        <Field id="personalComment" label={t(locale, 'personalComment')} error={errorFor('personalComment')}>
          <textarea id="personalComment" maxLength={1000} className="min-h-24 rounded-xl border border-line bg-canvas px-3 py-2" {...form.register('personalComment')} />
        </Field>
        <ChoiceButtons
          locale={locale}
          labelText={t(locale, 'sectionAccess')}
          value={values.personalSharing}
          onChange={(value: SharingMode) => form.setValue('personalSharing', value)}
          options={[
            { value: 'device_only', label: { ru: 'Только это устройство', en: 'This device only' } },
            { value: 'assigned_doctor', label: { ru: 'Назначенный врач', en: 'Assigned physician' } },
          ]}
        />
        {errorFor('personalSharing') ? <p className="text-sm text-danger">{errorFor('personalSharing')}</p> : null}
      </OptionalGate>
    </section>
  )
}

const intensityLabel = {
  light: { ru: 'Незначительные', en: 'Light' },
  moderate: { ru: 'Умеренные', en: 'Moderate' },
  heavy: { ru: 'Обильные', en: 'Heavy' },
  cannot_assess: { ru: 'Не могу оценить', en: 'I cannot assess it' },
} as const
