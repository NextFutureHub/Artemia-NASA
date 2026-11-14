import assert from 'node:assert/strict'
import test from 'node:test'
import { t } from '../i18n/copy.ts'
import { journalRouteAllowed, postLoginPath, preparationCanStart } from './acceptanceRoutes.ts'

test('A01 astronaut and doctor land on different allowed routes', () => {
  assert.equal(postLoginPath('astronaut', false), '/prepare')
  assert.equal(postLoginPath('astronaut', true), '/onboard/today')
  assert.equal(postLoginPath('doctor', false), '/ground/inbox')
  assert.equal(postLoginPath('doctor', true), '/ground/inbox')
})

test('A02 first preparation without a successful check set stays blocked', () => {
  assert.equal(preparationCanStart([], false), false)
  assert.equal(
    preparationCanStart(
      [
        { status: 'ok' },
        { status: 'failed' },
        { status: 'ok' },
      ],
      false,
    ),
    false,
  )
  assert.equal(
    preparationCanStart(
      Array.from({ length: 7 }, () => ({ status: 'ok' as const })),
      false,
    ),
    true,
  )
  assert.equal(
    preparationCanStart(
      Array.from({ length: 7 }, () => ({ status: 'ok' as const })),
      true,
    ),
    false,
  )
  assert.match(t('ru', 'firstPrepareOffline'), /Первую подготовку нельзя завершить/)
  assert.match(t('en', 'firstPrepareOffline'), /cannot finish without it/)
})

test('A03 prepared journal route does not require a live network token', () => {
  assert.equal(journalRouteAllowed(true), true)
  assert.equal(journalRouteAllowed(false), false)
})
