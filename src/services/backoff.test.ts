import assert from 'node:assert/strict'
import test from 'node:test'
import { retryDelayMs } from './backoff.ts'

test('retries follow 2, 5, 15, 30 and 60 seconds within twenty percent', () => {
  const expected = [2_000, 5_000, 15_000, 30_000, 60_000, 60_000]
  for (const [index, base] of expected.entries()) {
    const delay = retryDelayMs(index + 1, 0.5)
    assert.equal(delay, base)
    assert.ok(retryDelayMs(index + 1, 0) >= base * 0.8)
    assert.ok(retryDelayMs(index + 1, 1) <= base * 1.2)
  }
})
