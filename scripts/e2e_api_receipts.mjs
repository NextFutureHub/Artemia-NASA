import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const i = line.indexOf('=')
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
      }),
  )
}

const env = { ...loadEnvFile(path.join(root, '.env')), ...loadEnvFile(path.join(root, 'backups', 'e2e.env')) }
const API = (env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

function pastStamp(minutesAgo = 30) {
  const stamp = new Date(Date.now() - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, '.000Z')
  return stamp
}

function localDateFromIso(iso) {
  return iso.slice(0, 10)
}

function normalize(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(normalize)
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
}

function hashOperation(type, payload) {
  return createHash('sha256').update(JSON.stringify(normalize({ payload, schema_version: 1, type })), 'utf8').digest('hex')
}

async function login(email, password, role = 'astronaut') {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`login failed ${response.status} ${email.split('@')[0]}`)
  return body.access_token
}

async function postOp(token, type, payload) {
  const response = await fetch(`${API}/operations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation_id: randomUUID(),
      type,
      schema_version: 1,
      payload,
      hash: hashOperation(type, payload),
    }),
  })
  return { status: response.status, body: await response.json() }
}

const RECORDED = pastStamp(45)
const LOCAL_DATE = localDateFromIso(RECORDED)

const mira = await login(env.SEED_MIRA_EMAIL, env.SEED_MIRA_PASSWORD, 'astronaut')
const doc = await login(env.SEED_FLIGHT_DOC_EMAIL, env.SEED_FLIGHT_DOC_PASSWORD, 'doctor')
const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${mira}` } }).then((r) => r.json())
const prep = await fetch(`${API}/preparation`, { headers: { Authorization: `Bearer ${mira}` } }).then((r) => r.json())
const assignmentId = prep.assignment.id
const missionId = me.mission_id
const checkinId = randomUUID()
const revisionId = randomUUID()
const reportId = randomUUID()
const messageId = randomUUID()

const general = {
  overall_state: 'fair',
  sleep_hours: 7.5,
  sleep_answer_status: 'answered',
  sleep_quality: null,
  sleep_quality_answer_status: 'unknown',
  fatigue_score: 0,
  fatigue_answer_status: 'answered',
  stress_score: null,
  stress_answer_status: 'declined',
  emotional_state: { value: 'calm', note: null },
  context: [],
  comment: 'E2E diary',
  symptom_presence: 'no',
  symptoms: [],
  review_requested: false,
}

const checkin = await postOp(mira, 'checkin_bundle', {
  checkin: {
    id: checkinId,
    mission_id: missionId,
    local_date: LOCAL_DATE,
    timezone: 'UTC',
    type: 'daily',
    root_id: checkinId,
    device_id: 'e2e-device',
    recorded_at: RECORDED,
    created_at_device: RECORDED,
    source: 'manual',
    demo_dataset_id: null,
  },
  revision: {
    id: revisionId,
    parent_revision_id: null,
    revision_no: 1,
    general_payload: general,
    reason: null,
  },
  personal: null,
  measurement_ids: [],
})
console.log('checkin', checkin.status, checkin.body.status, checkin.body.error_code || '')

const snapshot = {
  schema_version: 1,
  revision_ids: [revisionId],
  measurements: [],
  explanatory_rule_versions: [],
  prepared_at: RECORDED,
  message: null,
  recipient_assignment_id: assignmentId,
  summary: 'За период заполнено 1 записей. Запрос просмотра: нет. Прикреплено 0 измерений, из них 0 с неизвестным качеством.',
  unit_system: 'metric',
}
const report = await postOp(mira, 'report_bundle', {
  report: {
    id: reportId,
    mission_id: missionId,
    recipient_assignment_id: assignmentId,
    title: 'E2E report',
    range_start: LOCAL_DATE,
    range_end: LOCAL_DATE,
    reason: 'planned',
    general_snapshot: snapshot,
    message: null,
    parent_report_id: null,
    device_id: 'e2e-device',
    recorded_at: RECORDED,
    created_at_device: RECORDED,
  },
  personal: null,
})
console.log('report', report.status, report.body.status, report.body.error_code || '')

const opened = await fetch(`${API}/missions/${missionId}/reports/${reportId}/opened`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${doc}`, 'Content-Type': 'application/json' },
  body: '{}',
})
console.log('opened', opened.status)

const reply = await fetch(`${API}/missions/${missionId}/reports/${reportId}/messages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${doc}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: messageId,
    message_type: 'clarifying_question',
    text: 'When did the change start?',
    sensitive: false,
    supersedes_id: null,
  }),
})
console.log('reply', reply.status)

const devicePayload = {
  id: randomUUID(),
  report_id: reportId,
  mission_id: missionId,
  ack_type: 'device_received',
  message_id: null,
  recorded_at: pastStamp(40),
  created_at_device: pastStamp(40),
}
const device = await postOp(mira, 'report_ack', devicePayload)
console.log('device_received', device.status, device.body.status, device.body.error_code || '', device.body.entity_refs)

const readPayload = {
  id: randomUUID(),
  report_id: reportId,
  mission_id: missionId,
  ack_type: 'patient_read',
  message_id: messageId,
  recorded_at: pastStamp(35),
  created_at_device: pastStamp(35),
}
const read = await postOp(mira, 'report_ack', readPayload)
console.log('patient_read', read.status, read.body.status, read.body.error_code || '', read.body.entity_refs)

const readAgain = await postOp(mira, 'report_ack', readPayload)
console.log('patient_read_idempotent', readAgain.status, readAgain.body.status)

const card = await fetch(`${API}/missions/${missionId}/reports/${reportId}`, {
  headers: { Authorization: `Bearer ${doc}` },
}).then((r) => r.json())
const kinds = (card.events || []).map((e) => e.event_type)
console.log('events', kinds.join(','))

const ok =
  checkin.body.status === 'accepted' &&
  report.body.status === 'accepted' &&
  device.body.status === 'accepted' &&
  (read.body.status === 'accepted' || read.body.status === 'duplicate') &&
  (readAgain.body.status === 'accepted' || readAgain.body.status === 'duplicate') &&
  kinds.includes('device_received') &&
  kinds.includes('patient_read')

console.log(JSON.stringify({ ok, reportId, kinds, recorded: RECORDED }))
process.exit(ok ? 0 : 1)
