import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { t } from '../i18n/copy.ts'
import { displayComment, explanationCard } from './explanations.ts'
import { EVIDENCE_CATALOG, visibleEvidence } from './evidenceCatalog.ts'
import { comparisonText, fatigueSeries, lineSegments, pulseSeries, sleepSeries, type PulseInput, type ScoreInput, type SleepInput } from './trends.ts'

test('a sleep gap stays empty and is not drawn as zero', () => {
  const series = sleepSeries([
    sleep('2026-11-01', 7),
    sleep('2026-11-02', null, 'unknown'),
    sleep('2026-11-04', 8),
  ])
  assert.deepEqual(series.points.map((item) => item.value), [7, 8])
  assert.equal(series.points[1]?.gapBefore, true)
  assert.equal(series.points.some((item) => item.value === 0), false)
  assert.equal(lineSegments(series.points).length, 2)
  assert.equal(comparisonText('ru', series.comparison), 'Недостаточно истории для сравнения')
  assert.equal(comparisonText('ru', series.comparison).toLowerCase().includes('норм'), false)
})

test('one daily sleep value is kept when a later change exists on the same date', () => {
  const rows: SleepInput[] = [
    sleep('2026-11-01', 6, 'answered', '2026-11-01T08:00:00.000Z'),
    { ...sleep('2026-11-01', 9, 'answered', '2026-11-01T20:00:00.000Z'), type: 'change' },
  ]
  assert.equal(sleepSeries(rows).points[0]?.value, 6)
})

test('five earlier days produce a personal median', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((day) => fatigue('2026-11-0' + day, day + 1))
  const series = fatigueSeries(rows)
  assert.equal(series.comparison.status, 'compared')
  if (series.comparison.status !== 'compared') return
  assert.equal(series.comparison.latest, 7)
  assert.equal(series.comparison.median, 4)
  assert.equal(comparisonText('ru', series.comparison).includes('Личная медиана'), true)
  assert.equal(comparisonText('en', series.comparison).toLowerCase().includes('normal'), false)
})

test('invalid and simulated pulse values stay out of the median', () => {
  const rows: PulseInput[] = [
    pulse('2026-11-01', 70, 'manual', 'unknown', 'rest'),
    pulse('2026-11-02', 72, 'manual', 'unknown', 'rest'),
    pulse('2026-11-03', 74, 'manual', 'unknown', 'rest'),
    pulse('2026-11-04', 76, 'manual', 'unknown', 'rest'),
    pulse('2026-11-05', 78, 'manual', 'unknown', 'rest'),
    pulse('2026-11-05', 180, 'simulated', 'valid', 'rest'),
    pulse('2026-11-06', 40, 'manual', 'invalid', 'rest'),
    pulse('2026-11-06', 80, 'manual', 'unknown', 'rest'),
  ]
  const series = pulseSeries(rows)
  const invalid = series.points.find((item) => item.quality === 'invalid')
  assert.equal(invalid?.plotted, false)
  assert.equal(series.points.find((item) => item.source === 'simulated')?.plotted, true)
  assert.equal(series.comparison.status, 'compared')
  if (series.comparison.status !== 'compared') return
  assert.equal(series.comparison.latest, 80)
  assert.equal(series.comparison.source, 'manual')
  assert.equal(series.comparison.median, 74)
})

test('a manual pulse is not averaged with a device pulse', () => {
  const rows = [1, 2, 3, 4, 5].map((day) => pulse('2026-11-0' + day, 60 + day, 'usb', 'valid', 'rest'))
  rows.push(pulse('2026-11-06', 90, 'manual', 'unknown', 'rest'))
  assert.equal(pulseSeries(rows).comparison.status, 'insufficient')
})

test('rule cards name their inputs and do not cite NASA as a threshold', () => {
  const card = explanationCard('HISTORY_CHANGE_V1', [{ label: 'sleep 2026-11-06', href: '/onboard/history' }], '2026-11-14T10:00:00.000Z')
  assert.equal(card.version, '1')
  assert.equal(card.prototype, true)
  assert.equal(card.sourceId, null)
  assert.equal(card.home, false)
  assert.equal(card.inputs[0]?.href, '/onboard/history')
  assert.equal(t('ru', 'historyChangeLimit').includes('не прикреплён'), true)
  assert.equal(t('ru', 'scaleRange', { min: 0, max: 24, unit: 'ч' }).toLowerCase().includes('не норма'), true)
  const nasa = EVIDENCE_CATALOG.find((item) => item.id === 'NASA-HRR')
  assert.ok(nasa)
  assert.equal(nasa.limitations.includes('одобрены NASA'), true)
})

test('evidence search keeps the local card and does not require a network result', () => {
  const found = visibleEvidence('roadmap', 'research_context')
  assert.equal(found.some((item) => item.id === 'NASA-HRR'), true)
  assert.equal(visibleEvidence('ограничения', 'prototype_rule')[0]?.url, '')
})

test('a comment stays literal text', () => {
  const value = '<img src=x onerror="alert(1)"><b>Самочувствие</b>'
  assert.equal(displayComment(value), value)
  const view = readFileSync(new URL('../features/checkin/CheckinViewPage.tsx', import.meta.url), 'utf8')
  assert.equal(view.includes('dangerouslySetInnerHTML'), false)
  assert.equal(view.includes('displayComment'), true)
})

test('the client and API sources do not carry a service role', () => {
  const client = readFileSync(new URL('../data/remote/client.ts', import.meta.url), 'utf8')
  const api = readFileSync(new URL('../../backend/app/main.py', import.meta.url), 'utf8')
  assert.equal(client.includes('service_role'), false)
  assert.equal(api.includes('service_role'), false)
  assert.equal(client.includes('console.'), false)
})

function sleep(date: string, hours: number | null, status = hours === null ? 'unknown' : 'answered', recordedAt = `${date}T08:00:00.000Z`): SleepInput {
  return { date, recordedAt, hours, status, invalidated: false, type: 'daily', href: `/onboard/checkin/${date}` }
}

function fatigue(date: string, score: number): ScoreInput {
  return { date, recordedAt: `${date}T08:00:00.000Z`, score, status: 'answered', invalidated: false, href: `/onboard/checkin/${date}` }
}

function pulse(date: string, value: number, source: PulseInput['source'], quality: PulseInput['quality'], context: string): PulseInput {
  return { recordedAt: `${date}T09:00:00.000Z`, date, value, source, quality, context, href: '/onboard/measurements' }
}
