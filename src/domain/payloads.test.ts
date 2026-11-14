import assert from 'node:assert/strict'
import test from 'node:test'
import { generalPayloadSchema } from './generalPayload.ts'
import { parseOperationPayload } from './operation.ts'
import { personalPayloadSchema } from './personalPayload.ts'
import { baseGeneral, skippedPersonal } from './fixtures.ts'

test('answered zero stays zero and a skip stays null', () => {
  const parsed = generalPayloadSchema.parse(baseGeneral())
  assert.equal(parsed.fatigue_score, 0)
  assert.equal(parsed.fatigue_answer_status, 'answered')
  assert.equal(parsed.stress_score, null)
  assert.equal(parsed.stress_answer_status, 'declined')
})

test('general payload rejects extra fields, sentinels, and a null marked answered', () => {
  const extra = generalPayloadSchema.safeParse({ ...baseGeneral(), diagnosis: 'none' })
  assert.equal(extra.success, false)

  const sentinel = generalPayloadSchema.safeParse({
    ...baseGeneral(),
    fatigue_score: -1,
    fatigue_answer_status: 'answered',
  })
  assert.equal(sentinel.success, false)

  const hiddenSkip = generalPayloadSchema.safeParse({
    ...baseGeneral(),
    sleep_hours: null,
    sleep_answer_status: 'answered',
  })
  assert.equal(hiddenSkip.success, false)

  const zeroAsSkip = generalPayloadSchema.safeParse({
    ...baseGeneral(),
    fatigue_score: 0,
    fatigue_answer_status: 'unknown',
  })
  assert.equal(zeroAsSkip.success, false)
})

test('personal payload rejects extra fields and keeps sharing out of the body', () => {
  const parsed = personalPayloadSchema.parse(skippedPersonal())
  assert.equal(parsed.bleeding_category, null)
  assert.equal(parsed.bleeding_intensity_answer_status, 'not_applicable')
  const extra = personalPayloadSchema.safeParse({ ...skippedPersonal(), sharing_mode: 'assigned_doctor' })
  assert.equal(extra.success, false)
})

test('checkin bundle rejects an unknown operation field', () => {
  const bundle = {
    checkin: {
      id: '20000000-0000-4000-8000-000000000001',
      mission_id: '20000000-0000-4000-8000-000000000010',
      local_date: '2026-11-01',
      timezone: 'UTC',
      type: 'daily',
      root_id: '20000000-0000-4000-8000-000000000001',
      device_id: 'device-1',
      recorded_at: '2026-11-01T08:00:00.000Z',
      created_at_device: '2026-11-01T08:00:00.000Z',
      source: 'manual',
      demo_dataset_id: null,
    },
    revision: {
      id: '20000000-0000-4000-8000-000000000002',
      parent_revision_id: null,
      revision_no: 1,
      general_payload: baseGeneral(),
      reason: null,
    },
    personal: null,
    measurement_ids: [],
    author_id: '20000000-0000-4000-8000-000000000099',
  }
  assert.equal(parseOperationPayload('checkin_bundle', bundle).success, false)
})
