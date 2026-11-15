import { ChoiceButtons } from '../../components/Choices.tsx'
import { Banner, Button, Field } from '../../components/ui.tsx'
import type { SleepIntervalDraft } from '../../domain/checkinDraft.ts'
import { zonedInputToDate } from '../../domain/clock.ts'
import type { SleepDurationSource } from '../../domain/enums.ts'
import {
  findOverlappingIntervals,
  intervalDurationHours,
  sumSleptIntervalHours,
  type SleepInterval,
} from '../../domain/sleepIntervals.ts'
import type { Locale } from '../../i18n/copy.ts'
import { t } from '../../i18n/copy.ts'

type Props = {
  locale: Locale
  timeZone: string
  overallHoursRaw: string
  overallUnknown: boolean
  intervals: SleepIntervalDraft[]
  durationSource: SleepDurationSource | null
  onIntervalsChange: (next: SleepIntervalDraft[]) => void
  onDurationSourceChange: (next: SleepDurationSource | null) => void
}

export function SleepIntervalsPanel({
  locale,
  timeZone,
  overallHoursRaw,
  overallUnknown,
  intervals,
  durationSource,
  onIntervalsChange,
  onDurationSourceChange,
}: Props) {
  const overall =
    overallUnknown || overallHoursRaw.trim() === '' ? null : Number(overallHoursRaw)
  const overallOk = overall !== null && Number.isFinite(overall) ? overall : null
  const domainIntervals = toDomainIntervals(intervals, timeZone)
  const intervalsTotal = sumSleptIntervalHours(domainIntervals)
  const overlap = findOverlappingIntervals(domainIntervals)
  const bothPresent = overallOk !== null && intervalsTotal !== null
  const conflict = bothPresent && Math.abs((overallOk as number) - intervalsTotal) > 0.25

  function update(index: number, patch: Partial<SleepIntervalDraft>) {
    onIntervalsChange(intervals.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-4" aria-labelledby="sleep-intervals-heading">
      <div>
        <p className="text-sm text-muted">{t(locale, 'optionalSection')}</p>
        <h3 id="sleep-intervals-heading" className="text-lg">
          {t(locale, 'sleepIntervalsTitle')}
        </h3>
        <p className="mt-1 text-sm text-muted">{t(locale, 'sleepIntervalsLead')}</p>
      </div>

      {intervals.length === 0 ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onIntervalsChange([emptyInterval('primary')])}
        >
          {t(locale, 'sleepAddInterval')}
        </Button>
      ) : (
        <ul className="flex flex-col gap-3">
          {intervals.map((item, index) => {
            const start = zonedInputToDate(item.startLocal, timeZone)
            const end = zonedInputToDate(item.endLocal, timeZone)
            const hours =
              start && end ? intervalDurationHours(start.toISOString(), end.toISOString()) : null
            return (
              <li key={`sleep-interval-${index}`} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted">
                    {item.kind === 'primary' ? t(locale, 'sleepIntervalPrimary') : t(locale, 'sleepIntervalAdditional')}
                    {hours !== null ? ` · ${Math.round(hours * 2) / 2} ${t(locale, 'hoursUnit')}` : ''}
                  </p>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      const next = intervals.filter((_, i) => i !== index)
                      onIntervalsChange(next)
                      if (next.length === 0) onDurationSourceChange(null)
                    }}
                  >
                    {t(locale, 'sleepRemoveInterval')}
                  </Button>
                </div>
                <Field id={`sleep-start-${index}`} label={t(locale, 'sleepIntervalStart')}>
                  <input
                    id={`sleep-start-${index}`}
                    type="datetime-local"
                    className="min-h-11 rounded-xl border border-line bg-canvas px-3"
                    value={item.startLocal}
                    onChange={(event) => update(index, { startLocal: event.target.value })}
                  />
                </Field>
                <Field id={`sleep-end-${index}`} label={t(locale, 'sleepIntervalEnd')} hint={t(locale, 'sleepAcrossMidnightHint')}>
                  <input
                    id={`sleep-end-${index}`}
                    type="datetime-local"
                    className="min-h-11 rounded-xl border border-line bg-canvas px-3"
                    value={item.endLocal}
                    onChange={(event) => update(index, { endLocal: event.target.value })}
                  />
                </Field>
                <ChoiceButtons
                  locale={locale}
                  labelText={t(locale, 'sleepIntervalState')}
                  value={item.quality}
                  onChange={(value) => update(index, { quality: value })}
                  options={[
                    { value: 'slept', label: { ru: 'Спал(а)', en: 'Slept' } },
                    { value: 'in_bed', label: { ru: 'В постели', en: 'In bed' } },
                  ]}
                />
              </li>
            )
          })}
        </ul>
      )}

      {intervals.length > 0 ? (
        <Button
          type="button"
          variant="quiet"
          onClick={() =>
            onIntervalsChange([...intervals, emptyInterval(intervals.some((item) => item.kind === 'primary') ? 'additional' : 'primary')])
          }
        >
          {t(locale, 'sleepAddInterval')}
        </Button>
      ) : null}

      {overlap ? <Banner tone="attention">{t(locale, 'sleepOverlapFix')}</Banner> : null}

      {intervalsTotal !== null ? (
        <p className="text-sm text-muted">
          {t(locale, 'sleepIntervalsSum')}: {Math.round(intervalsTotal * 2) / 2} {t(locale, 'hoursUnit')}
          {intervals.some((item) => item.quality === 'in_bed') ? ` · ${t(locale, 'sleepInBedNotConfirmed')}` : ''}
        </p>
      ) : null}

      {bothPresent ? (
        <div className="flex flex-col gap-2">
          {conflict ? <Banner tone="attention">{t(locale, 'sleepSourceConflict')}</Banner> : null}
          <ChoiceButtons
            locale={locale}
            labelText={t(locale, 'sleepDurationSource')}
            value={durationSource}
            onChange={(value) => onDurationSourceChange(value)}
            options={[
              {
                value: 'overall',
                label: {
                  ru: `Общая оценка (${overallOk} ч)`,
                  en: `Overall estimate (${overallOk} h)`,
                },
              },
              {
                value: 'intervals',
                label: {
                  ru: `По интервалам (${Math.round((intervalsTotal as number) * 2) / 2} ч)`,
                  en: `From intervals (${Math.round((intervalsTotal as number) * 2) / 2} h)`,
                },
              },
            ]}
          />
          <p className="text-sm text-muted">{t(locale, 'sleepNoDoubleSum')}</p>
        </div>
      ) : null}
    </section>
  )
}

function emptyInterval(kind: SleepIntervalDraft['kind']): SleepIntervalDraft {
  return { startLocal: '', endLocal: '', kind, quality: 'slept' }
}

function toDomainIntervals(intervals: SleepIntervalDraft[], timeZone: string): SleepInterval[] {
  return intervals.flatMap((item) => {
    const start = zonedInputToDate(item.startLocal, timeZone)
    const end = zonedInputToDate(item.endLocal, timeZone)
    if (!start || !end) return []
    return [
      {
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        kind: item.kind,
        quality: item.quality,
      },
    ]
  })
}
