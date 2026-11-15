import { label, type Locale } from '../i18n/copy.ts'

export function ChoiceButtons<T extends string>({
  labelText,
  value,
  options,
  onChange,
  locale,
  hideLegend = false,
}: {
  labelText: string
  value: T | null
  options: Array<{ value: T; label: { ru: string; en: string } }>
  onChange: (value: T) => void
  locale: Locale
  hideLegend?: boolean
}) {
  return (
    <fieldset>
      <legend className={hideLegend ? 'sr-only' : 'mb-2 text-sm'}>{labelText}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={labelText}>
        {options.map((option) => {
          const selected = value === option.value
          return (
            <button
              key={option.value}
              id={`${labelText}-${option.value}`}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`min-h-11 rounded-xl border px-3 ${selected ? 'border-accent text-accent' : 'border-line text-ink'}`}
              onClick={() => onChange(option.value)}
            >
              {label(locale, option.label)}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
