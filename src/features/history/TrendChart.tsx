import { Link } from 'react-router-dom'
import { comparisonText, lineSegments, type TrendSeries } from '../../domain/trends.ts'
import { t, type Locale } from '../../i18n/copy.ts'

export function TrendChart({ series, locale }: { series: TrendSeries; locale: Locale }) {
  const plotted = series.points.filter((point) => point.plotted && point.value !== null)
  const excluded = series.points.filter((point) => !point.plotted)
  const title = t(locale, series.metric === 'sleep' ? 'sleepChart' : series.metric === 'fatigue' ? 'fatigueChart' : 'pulseChart')
  const unit = t(locale, series.unit === 'hours' ? 'hoursUnit' : series.unit === 'score' ? 'scoreUnit' : 'bpmUnit')
  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-xl">{title}</h2>
      <p className="text-sm text-muted">
        {t(locale, 'scaleRange', { min: series.yMin, max: series.yMax, unit })}
      </p>
      <svg viewBox="0 0 320 140" className="mt-3 h-36 w-full" aria-hidden="true">
        <line x1="28" y1="12" x2="28" y2="112" stroke="currentColor" strokeOpacity="0.35" />
        <line x1="28" y1="112" x2="308" y2="112" stroke="currentColor" strokeOpacity="0.35" />
        <text x="4" y="16" fill="currentColor" fontSize="10">{series.yMax}</text>
        <text x="4" y="112" fill="currentColor" fontSize="10">{series.yMin}</text>
        {lineSegments(series.points).map((segment) => (
          <polyline
            key={segment.map((point) => point.at).join('-')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={segment[0]?.source === 'simulated' ? '4 3' : undefined}
            points={segment.map((point) => `${xOf(point.date, series)} ${yOf(point.value ?? series.yMin, series)}`).join(' ')}
          />
        ))}
        {plotted.map((point) => (
          <circle
            key={point.at}
            cx={xOf(point.date, series)}
            cy={yOf(point.value ?? series.yMin, series)}
            r={point.source === 'manual' ? 4 : 3}
            fill={point.source === 'usb' ? 'none' : 'currentColor'}
            stroke="currentColor"
          />
        ))}
      </svg>
      <p className="text-sm">{comparisonText(locale, series.comparison)}</p>
      {series.comparison.status === 'compared' ? (
        <p className="text-sm text-muted">
          {t(locale, 'howCalculated', { count: series.comparison.observations, days: series.comparison.days })}
        </p>
      ) : null}
      <ul className="mt-2 flex flex-col gap-1">
        {plotted.map((point) => (
          <li key={point.at}>
            <Link className="inline-flex min-h-11 items-center" to={point.href}>
              {point.date} · {point.value} {unit} · {t(locale, sourceKey(point.source))} · {t(locale, qualityKey(point.quality))}
            </Link>
          </li>
        ))}
        {excluded.map((point) => (
          <li key={`${point.at}-out`} className="text-sm text-muted">
            {point.date} · {t(locale, 'excludedPoint')} · {t(locale, qualityKey(point.quality))}
          </li>
        ))}
      </ul>
    </article>
  )
}

function sourceKey(source: 'manual' | 'usb' | 'simulated') {
  if (source === 'usb') return 'sourceDevice' as const
  if (source === 'simulated') return 'sourceSimulated' as const
  return 'sourceManual' as const
}

function qualityKey(quality: 'unknown' | 'valid' | 'invalid' | 'insufficient') {
  if (quality === 'invalid') return 'qualityInvalid' as const
  if (quality === 'insufficient') return 'qualityInsufficient' as const
  if (quality === 'valid') return 'qualityValid' as const
  return 'qualityUnknown' as const
}

function xOf(date: string, series: TrendSeries): number {
  const dates = series.points.map((point) => point.date).sort()
  const start = Date.parse(`${dates[0]}T00:00:00Z`)
  const end = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`)
  const current = Date.parse(`${date}T00:00:00Z`)
  if (end === start) return 168
  return 28 + ((current - start) / (end - start)) * 280
}

function yOf(value: number, series: TrendSeries): number {
  const span = series.yMax - series.yMin || 1
  return 112 - ((value - series.yMin) / span) * 100
}
