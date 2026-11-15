import type { ReactNode } from 'react'
import type { Locale } from '../i18n/copy.ts'
import { t } from '../i18n/copy.ts'

/** Compact step rail for multi-step forms — current step is the only strong accent. */
export function StepRail({
  steps,
  current,
  locale,
}: {
  steps: Array<{ id: string; label: string }>
  current: string
  locale: Locale
}) {
  const index = Math.max(0, steps.findIndex((step) => step.id === current))
  const active = steps[index]
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label={t(locale, 'stepsLabel')}>
        {steps.map((step, stepIndex) => {
          const isCurrent = step.id === current
          const done = stepIndex < index
          return (
            <li key={step.id} className={isCurrent ? 'text-accent' : done ? 'text-ink' : 'text-muted'}>
              <span className="numeric">{stepIndex + 1}</span>
              <span className="sr-only">. </span>
              <span className={isCurrent ? '' : 'hidden sm:inline'}> {step.label}</span>
            </li>
          )
        })}
      </ol>
      {active ? (
        <div>
          <p className="text-sm text-muted">
            {t(locale, 'stepOf', { current: index + 1, total: steps.length })}
          </p>
          <h1 className="text-2xl sm:text-3xl">{active.label}</h1>
        </div>
      ) : null}
    </div>
  )
}

/** Optional section chrome: Fill / Skip, no medical preselection implied. */
export function OptionalGate({
  locale,
  title,
  lead,
  choice,
  onFill,
  onSkip,
  children,
}: {
  locale: Locale
  title: string
  lead: string
  choice: 'fill' | 'skip' | null
  onFill: () => void
  onSkip: () => void
  children?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-4">
      <div>
        <p className="text-sm text-muted">{t(locale, 'optionalSection')}</p>
        <h2 className="text-xl">{title}</h2>
        <p className="mt-1 text-sm text-muted">{lead}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={choice === 'fill'}
          className={`min-h-11 rounded-xl border px-4 ${choice === 'fill' ? 'border-accent text-accent' : 'border-line'}`}
          onClick={onFill}
        >
          {t(locale, 'fillSection')}
        </button>
        <button
          type="button"
          aria-pressed={choice === 'skip'}
          className={`min-h-11 rounded-xl border px-4 ${choice === 'skip' ? 'border-accent text-accent' : 'border-line'}`}
          onClick={onSkip}
        >
          {t(locale, 'skipSection')}
        </button>
      </div>
      {choice === 'skip' ? <p className="text-sm text-muted">{t(locale, 'sectionSkippedHint')}</p> : null}
      {choice === 'fill' ? children : null}
    </section>
  )
}

/** Quiet status line for review summaries — distinguishes answered / unknown / declined / skipped. */
export function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="sm:text-right">{value}</p>
    </div>
  )
}

export function PageIntro({
  title,
  subtitle,
  meta,
}: {
  title: string
  subtitle?: string
  meta?: string
}) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-3xl">{title}</h1>
      {meta ? <p className="numeric text-sm text-muted">{meta}</p> : null}
      {subtitle ? <p className="text-muted">{subtitle}</p> : null}
    </header>
  )
}

export function ProfileGroup({
  title,
  lead,
  children,
}: {
  title: string
  lead?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div>
        <h2 className="text-xl">{title}</h2>
        {lead ? <p className="mt-1 text-sm text-muted">{lead}</p> : null}
      </div>
      {children}
    </section>
  )
}
