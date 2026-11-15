import assert from 'node:assert/strict'
import test from 'node:test'
import { consentApplyState, mergeReportStatus, nextMemorySlice, previewMatchesSnapshot, buildReportSnapshot, templateSummary } from './reportSnapshot.ts'

const recipient = '10000000-0000-4000-8000-000000000021'
const revision = '10000000-0000-4000-8000-000000000208'

test('the template summary has no sensitive fields and no diagnosis', () => {
  const text = templateSummary('ru', { records: 2, reviewRequested: true, measurements: 3, unknownQuality: 1 })
  assert.equal(text, 'За период заполнено 2 записей. Запрос просмотра: да. Прикреплено 3 измерений, из них 1 с неизвестным качеством.')
  assert.equal(text.includes('менстр'), false)
  assert.equal(text.includes('норм'), false)
})

test('preview and snapshot are the same object contents', () => {
  const built = buildReportSnapshot({
    revisionIds: [revision],
    measurements: [
      {
        measurement_id: '10000000-0000-4000-8000-000000000301',
        metric: 'heart_rate',
        value: 72,
        unit: 'bpm',
        source: 'manual',
        quality: 'unknown',
        recorded_at: '2026-11-14T11:00:00.000Z',
      },
    ],
    reviewRequested: false,
    preparedAt: '2026-11-14T12:00:00.000Z',
    message: null,
    recipientAssignmentId: recipient,
    locale: 'ru',
    unitSystem: 'metric',
  })
  assert.ok(built.snapshot)
  const preview = built.snapshot
  assert.equal(previewMatchesSnapshot(preview, built.snapshot), true)
  assert.equal(JSON.stringify(preview).includes('bleeding_category'), false)
  const changed = { ...preview, message: 'другое' }
  assert.equal(previewMatchesSnapshot(preview, changed), false)
})

test('accepted delivery does not mark the report opened', () => {
  const accepted = mergeReportStatus('accepted', [{ event_type: 'accepted', server_at: '2026-11-14T12:00:00.000Z' }])
  assert.equal(accepted.delivery, 'accepted')
  assert.equal(accepted.doctorWork, 'not_opened')
  const opened = mergeReportStatus('accepted', [
    { event_type: 'accepted', server_at: '2026-11-14T12:00:00.000Z' },
    { event_type: 'opened', server_at: '2026-11-14T12:05:00.000Z' },
  ])
  assert.equal(opened.delivery, 'accepted')
  assert.equal(opened.doctorWork, 'opened')
  assert.notEqual(opened.openedAt, accepted.openedAt)
  const replied = mergeReportStatus(opened.delivery, [
    { event_type: 'opened', server_at: '2026-11-14T12:05:00.000Z' },
    { event_type: 'replied', server_at: '2026-11-14T12:06:00.000Z' },
  ])
  assert.equal(replied.doctorWork, 'replied')
  assert.equal(replied.delivery, 'accepted')
})

test('an offline revoke waits for the server and a lost link keeps the last slice', () => {
  assert.equal(consentApplyState(false), 'waiting_for_server')
  assert.equal(consentApplyState(true), 'applied')
  const first = nextMemorySlice(null, { kind: 'data', data: { reports: 1 } }, '2026-11-14T12:00:00.000Z')
  assert.equal(first.mode, 'live')
  const stale = nextMemorySlice(first.slice, { kind: 'offline' }, '2026-11-14T12:10:00.000Z')
  assert.equal(stale.mode, 'stale')
  assert.equal(stale.slice?.capturedAt, '2026-11-14T12:00:00.000Z')
  assert.deepEqual(stale.slice?.data, { reports: 1 })
  const cleared = nextMemorySlice(stale.slice, { kind: 'denied' }, '2026-11-14T12:11:00.000Z')
  assert.equal(cleared.slice, null)
  assert.equal(cleared.mode, 'denied')
})
