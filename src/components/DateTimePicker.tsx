import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { dateToZonedInput } from '../domain/clock.ts'
import { t, type Locale } from '../i18n/copy.ts'
import { Button } from './ui.tsx'

type Parts = { year: number; month: number; day: number; hour: number; minute: number }

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export function DateTimePicker({
  id,
  value,
  onChange,
  locale,
  timeZone,
  disabled = false,
}: {
  id: string
  value: string
  onChange: (next: string) => void
  locale: Locale
  timeZone?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const parsed = useMemo(() => parseLocal(value), [value])
  const [view, setView] = useState(() => ({
    year: parsed?.year ?? new Date().getFullYear(),
    month: parsed?.month ?? new Date().getMonth() + 1,
  }))
  const [draft, setDraft] = useState<Parts>(() => parsed ?? nowParts(timeZone))

  useEffect(() => {
    if (!open) return
    const next = parsed ?? nowParts(timeZone)
    setDraft(next)
    setView({ year: next.year, month: next.month })
  }, [open, parsed, timeZone])

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const weeks = useMemo(() => monthGrid(view.year, view.month), [view.year, view.month])
  const weekdays = useMemo(() => weekdayLabels(locale), [locale])
  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'ru' ? 'ru' : 'en', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(view.year, view.month - 1, 1))),
    [locale, view.month, view.year],
  )

  function commit(parts: Parts) {
    onChange(formatLocal(parts))
  }

  function selectDay(day: number) {
    const next = { ...draft, year: view.year, month: view.month, day }
    setDraft(next)
    commit(next)
  }

  function setTime(part: 'hour' | 'minute', raw: string) {
    const number = Number(raw)
    if (!Number.isFinite(number)) return
    const next = {
      ...draft,
      [part]: part === 'hour' ? clamp(number, 0, 23) : clamp(number, 0, 59),
    }
    setDraft(next)
    commit(next)
  }

  function shiftMonth(delta: number) {
    const date = new Date(Date.UTC(view.year, view.month - 1 + delta, 1))
    setView({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 })
  }

  function setNow() {
    const next = nowParts(timeZone)
    setDraft(next)
    setView({ year: next.year, month: next.month })
    commit(next)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-3 text-left disabled:opacity-50"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={parsed ? 'numeric text-ink' : 'text-muted'}>
          {parsed ? formatDisplay(parsed, locale, timeZone) : t(locale, 'pickDateTime')}
        </span>
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </button>
      {open ? (
        <div
          id={listId}
          role="dialog"
          aria-label={t(locale, 'pickDateTime')}
          className="absolute z-30 mt-2 w-[min(100%,22rem)] rounded-xl border border-line bg-surface p-3 shadow-lg shadow-black/30"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button type="button" className="min-h-11 min-w-11 rounded-xl border border-line" aria-label={t(locale, 'prevMonth')} onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <p className="text-sm capitalize">{monthTitle}</p>
            <button type="button" className="min-h-11 min-w-11 rounded-xl border border-line" aria-label={t(locale, 'nextMonth')} onClick={() => shiftMonth(1)}>
              ›
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-muted">
            {weekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {weeks.flat().map((cell, index) => {
              if (cell === null) return <span key={`empty-${index}`} />
              const selected = draft.year === view.year && draft.month === view.month && draft.day === cell
              const isToday = isSameDay(cell, view, nowParts(timeZone))
              return (
                <button
                  key={`${view.year}-${view.month}-${cell}`}
                  type="button"
                  className={`numeric min-h-11 rounded-xl text-sm ${
                    selected ? 'bg-accent text-canvas' : isToday ? 'border border-accent text-accent' : 'border border-transparent hover:border-line'
                  }`}
                  onClick={() => selectDay(cell)}
                >
                  {cell}
                </button>
              )
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm text-muted">
              {t(locale, 'hour')}
              <select
                className="numeric min-h-11 rounded-xl border border-line bg-canvas px-3 text-ink"
                value={String(draft.hour).padStart(2, '0')}
                onChange={(event) => setTime('hour', event.target.value)}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={String(hour).padStart(2, '0')}>
                    {String(hour).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              {t(locale, 'minute')}
              <select
                className="numeric min-h-11 rounded-xl border border-line bg-canvas px-3 text-ink"
                value={String(draft.minute).padStart(2, '0')}
                onChange={(event) => setTime('minute', event.target.value)}
              >
                {Array.from({ length: 60 }, (_, minute) => (
                  <option key={minute} value={String(minute).padStart(2, '0')}>
                    {String(minute).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={setNow}>
              {t(locale, 'useNow')}
            </Button>
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
              {t(locale, 'done')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function parseLocal(value: string): Parts | null {
  const match = LOCAL_RE.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  return { year, month, day, hour, minute }
}

function formatLocal(parts: Parts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

function formatDisplay(parts: Parts, locale: Locale, timeZone?: string): string {
  const dateLabel = new Intl.DateTimeFormat(locale === 'ru' ? 'ru' : 'en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)))
  const clock = `${pad(parts.hour)}:${pad(parts.minute)}`
  return timeZone ? `${dateLabel} · ${clock} ${timeZone}` : `${dateLabel} · ${clock}`
}

function nowParts(timeZone?: string): Parts {
  if (timeZone) {
    const local = dateToZonedInput(new Date(), timeZone)
    return parseLocal(local) ?? wallParts(new Date())
  }
  return wallParts(new Date())
}

function wallParts(value: Date): Parts {
  return {
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
    hour: value.getHours(),
    minute: value.getMinutes(),
  }
}

function monthGrid(year: number, month: number): Array<Array<number | null>> {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const startWeekday = (first.getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<number | null> = Array.from({ length: startWeekday }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: Array<Array<number | null>> = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7))
  return weeks
}

function weekdayLabels(locale: Locale): string[] {
  const formatter = new Intl.DateTimeFormat(locale === 'ru' ? 'ru' : 'en', { weekday: 'short', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, index) => {
    const mondayBased = new Date(Date.UTC(2024, 0, 1 + index))
    return formatter.format(mondayBased)
  })
}

function isSameDay(day: number, view: { year: number; month: number }, now: Parts): boolean {
  return now.year === view.year && now.month === view.month && now.day === day
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
