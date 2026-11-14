import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { canonicalJson, hashOperation, sha256Hex } from './canonicalJson.ts'

const sample = {
  zero: 0,
  skip: null,
  note: 'Самочувствие café',
  tags: ['сон', 'sleep'],
  nested: { b: 1, a: null },
}

test('canonical JSON sorts keys and keeps null, zero, and unicode', () => {
  const text = canonicalJson(sample)
  assert.equal(
    text,
    '{"nested":{"a":null,"b":1},"note":"Самочувствие café","skip":null,"tags":["сон","sleep"],"zero":0}',
  )
  assert.equal(canonicalJson({ b: 1, a: null }), canonicalJson({ a: null, b: 1 }))
})

test('canonical JSON escapes quotes, slashes, and newlines', () => {
  const text = canonicalJson({ quote: 'say "hi"', slash: 'a\\b', breakLine: 'a\nb', sep: 'line\u2028sep' })
  assert.equal(text, '{"breakLine":"a\\nb","quote":"say \\"hi\\"","sep":"line\u2028sep","slash":"a\\\\b"}')
})

test('undefined and non-finite numbers are rejected', () => {
  assert.throws(() => canonicalJson({ value: undefined }), /undefined_value/)
  assert.throws(() => canonicalJson(Number.NaN), /non_finite_number/)
})

test('sha256 matches an independent UTF-8 digest', async () => {
  const text = canonicalJson(sample)
  const expected = createHash('sha256').update(text, 'utf8').digest('hex')
  assert.equal(await sha256Hex(text), expected)
  const again = await hashOperation({ schemaVersion: 1, type: 'checkin_bundle', payload: sample })
  const reordered = await hashOperation({
    schemaVersion: 1,
    type: 'checkin_bundle',
    payload: { tags: ['сон', 'sleep'], nested: { a: null, b: 1 }, note: 'Самочувствие café', skip: null, zero: 0 },
  })
  assert.equal(again, reordered)
})
