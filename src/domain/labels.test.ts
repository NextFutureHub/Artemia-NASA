import assert from 'node:assert/strict'
import test from 'node:test'
import { feedEventLabel, metricLabel, outboxEntityLabel, outboxStateLabel, qualityLabel, sourceLabel } from './labels.ts'

test('measurement labels stay localized instead of raw enums', () => {
  assert.equal(metricLabel('ru', 'heart_rate'), 'Пульс')
  assert.equal(qualityLabel('en', 'unknown'), 'Unknown')
  assert.equal(sourceLabel('ru', 'manual'), 'Ручной ввод')
})

test('queue and feed labels stay human-readable', () => {
  assert.equal(outboxEntityLabel('ru', 'checkin_bundle'), 'Самочувствие')
  assert.equal(outboxStateLabel('en', 'retry_wait'), 'Retry after a pause')
  assert.equal(feedEventLabel('ru', 'doctor_opened'), 'Просмотр врачом')
  assert.equal(feedEventLabel('en', 'delivery_confirmed'), 'Delivery confirmed')
})
