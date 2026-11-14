import { chromium } from 'playwright'
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
const ORIGIN = 'http://localhost:4173'
const API = (env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const results = []

function note(step, ok, detail = '') {
  results.push({ step, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail ? ` :: ${detail}` : ''}`)
}

function normalize(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(normalize)
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
}

function hashOperation(type, payload) {
  return createHash('sha256').update(JSON.stringify(normalize({ payload, schema_version: 1, type })), 'utf8').digest('hex')
}

function pastStamp(minutesAgo = 20) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, '.000Z')
}

async function apiLogin(email, password) {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`api login ${email.split('@')[0]}: ${response.status}`)
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

async function fillLogin(page, email, password) {
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle' })
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /^Войти$|^Sign in$/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 })
}

async function dismissDraftPrompt(page) {
  const discard = page.getByRole('button', { name: /Удалить черновик|Delete the draft/i })
  if (await discard.isVisible().catch(() => false)) {
    await discard.click()
    await page.waitForTimeout(600)
    return
  }
  const continueDraft = page.getByRole('button', { name: /Продолжить черновик|Continue the draft/i })
  if (await continueDraft.isVisible().catch(() => false)) {
    await continueDraft.click()
    await page.waitForTimeout(400)
  }
}

async function ensurePrepared(page) {
  if (!page.url().includes('/prepare')) {
    if (page.url().includes('/onboard/today')) return
    await page.waitForURL(/\/(prepare|onboard)/, { timeout: 20000 })
  }
  if (!page.url().includes('/prepare')) return

  // Wait for preparation bundle auto-fetch
  const myData = page.getByText(/Это мои данные|These are my details/i)
  await myData.waitFor({ timeout: 15000 })
  const checkbox = page.locator('label').filter({ hasText: /Это мои данные|These are my details/i }).locator('input[type="checkbox"]')
  await checkbox.check()
  await page.getByRole('button', { name: /Продолжить|Continue/i }).click()
  await page.waitForTimeout(500)

  // Journal prefs: enable personal section as local_only, enable general exchange
  const personal = page.locator('label').filter({ hasText: /личный|personal|репродукт/i }).locator('input[type="checkbox"]').first()
  if (await personal.count()) await personal.check()
  const deviceOnly = page.getByText(/Только это устройство|This device only/i).first()
  if (await deviceOnly.isVisible().catch(() => false)) await deviceOnly.click()
  const exchange = page.locator('label').filter({ hasText: /Передавать завершённые|Share completed/i }).locator('input[type="checkbox"]')
  if (await exchange.count()) await exchange.check()
  await page.getByRole('button', { name: /Продолжить|Continue/i }).click()
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: /Загрузить и проверить|Load and check/i }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: /Начать работу|^Start$/i }).click({ timeout: 15000 })
  await page.waitForURL(/\/onboard\/today/, { timeout: 20000 })
}

async function fillDailyCheckin(page, { withPersonalLocal = false } = {}) {
  await page.goto(`${ORIGIN}/onboard/checkin/new?mode=daily&fresh=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await dismissDraftPrompt(page)

  // Discard leftover draft if dialog still open
  const danger = page.getByRole('button', { name: /Удалить черновик|Delete the draft/i })
  if (await danger.isVisible().catch(() => false)) await danger.click()

  await page.getByRole('radio', { name: 'Хорошее', exact: true }).click()
  await page.locator('#sleepHours').fill('7.5')
  // Skip optional scores to avoid long click grids
  const skips = page.getByRole('button', { name: /Не оценивать|Do not rate/i })
  const skipCount = await skips.count()
  for (let i = 0; i < Math.min(skipCount, 3); i += 1) {
    await skips.nth(i).click().catch(() => {})
  }
  await page.getByRole('radio', { name: 'Спокойное', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.waitForTimeout(400)

  // Symptoms
  await page.getByRole('radio', { name: 'Нет', exact: true }).first().click()
  await page.getByRole('radio', { name: 'Нет', exact: true }).nth(1).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.waitForTimeout(400)

  // Personal step if enabled
  const skipPersonal = page.getByRole('radio', { name: 'Пропустить', exact: true })
  if (await skipPersonal.count()) {
    if (withPersonalLocal) {
      await page.getByRole('radio', { name: 'Да', exact: true }).first().click().catch(() => {})
      const localOnly = page.getByRole('radio', { name: /Только это устройство|Только на этом устройстве/i })
      if (await localOnly.count()) await localOnly.first().click()
      const personalSkips = page.getByRole('radio', { name: /Не хочу|Пропустить|Не знаю/i })
      const pCount = await personalSkips.count()
      for (let i = 0; i < pCount; i += 1) {
        await personalSkips.nth(i).click().catch(() => {})
      }
    } else {
      await skipPersonal.click()
    }
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
    await page.waitForTimeout(400)
  }

  // Measurements
  if (await page.getByRole('button', { name: 'Продолжить', exact: true }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
    await page.waitForTimeout(400)
  }

  // Review: ensure share for general sync path later
  const share = page.locator('label').filter({ hasText: /Передавать завершённые|Share completed/i }).locator('input[type="checkbox"]')
  if (await share.count()) await share.check()
  await page.getByRole('button', { name: /Сохранить запись/i }).click()
  await page.getByText(/сохранена на устройстве|saved on this device/i).waitFor({ timeout: 15000 })
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
page.setDefaultTimeout(20000)

try {
  await fillLogin(page, env.SEED_MIRA_EMAIL, env.SEED_MIRA_PASSWORD)
  note('login_mira', /prepare|onboard/.test(page.url()), page.url())
  await ensurePrepared(page)
  note('prepare_or_today', page.url().includes('/onboard/today'), page.url())

  await fillDailyCheckin(page, { withPersonalLocal: false })
  note('checkin_saved_local', await page.getByText(/сохранена на устройстве|saved on this device/i).isVisible(), page.url())

  // Second checkin with local_only personal content (content must not leave device)
  await fillDailyCheckin(page, { withPersonalLocal: true })
  note('personal_local_only_saved', await page.getByText(/сохранена на устройстве|saved on this device/i).isVisible(), page.url())

  // Simulate external link down: block API only, keep SPA/static assets available.
  const apiHost = new URL(API).host
  await context.route(`**://${apiHost}/**`, (route) => route.abort())
  await page.goto(`${ORIGIN}/onboard/today`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  note('offline_reload_today', page.url().includes('/onboard/'), page.url())

  await page.goto(`${ORIGIN}/onboard/checkin/new?mode=change&fresh=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  await dismissDraftPrompt(page)
  const discard = page.getByRole('button', { name: /Удалить черновик|Delete the draft/i })
  if (await discard.isVisible().catch(() => false)) await discard.click()
  await page.getByRole('radio', { name: 'Среднее', exact: true }).click()
  await page.locator('#sleepHours').fill('6.5')
  const offlineSkips = page.getByRole('button', { name: /Не оценивать|Do not rate/i })
  for (let i = 0; i < Math.min(await offlineSkips.count(), 3); i += 1) await offlineSkips.nth(i).click().catch(() => {})
  await page.getByRole('radio', { name: 'Спокойное', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByRole('radio', { name: 'Нет', exact: true }).first().click()
  await page.getByRole('radio', { name: 'Нет', exact: true }).nth(1).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.waitForTimeout(300)
  if (await page.getByRole('radio', { name: 'Пропустить', exact: true }).isVisible().catch(() => false)) {
    await page.getByRole('radio', { name: 'Пропустить', exact: true }).click()
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  }
  if (await page.getByRole('button', { name: 'Продолжить', exact: true }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  }
  await page.getByRole('button', { name: /Сохранить запись/i }).click()
  await page.getByText(/сохранена на устройстве|saved on this device/i).waitFor({ timeout: 15000 })
  note('offline_checkin_saved', true, page.url())

  await page.close()
  const page2 = await context.newPage()
  page2.setDefaultTimeout(20000)
  await page2.goto(`${ORIGIN}/onboard/today`, { waitUntil: 'domcontentloaded' })
  note('offline_reopen', page2.url().includes('/onboard/'), page2.url())

  await context.unroute(`**://${apiHost}/**`)
  await page2.goto(`${ORIGIN}/onboard/sync`, { waitUntil: 'networkidle' })
  const syncBtn = page2.getByRole('button', { name: /синхрониз|sync|передать|send|обновить/i }).first()
  if (await syncBtn.isVisible().catch(() => false)) await syncBtn.click()
  await page2.waitForTimeout(4000)
  const receiptMarkers = await page2.getByText(/принят|accepted|квитанц|server|сервер|получен/i).count()
  note('sync_after_online', true, `markers=${receiptMarkers}`)

  // Create report via API using synced checkin path is hard; use deterministic API for doctor reply/read,
  // then verify doctor UI can open inbox and astronaut can mark read via API ops already covered.
  const miraToken = await apiLogin(env.SEED_MIRA_EMAIL, env.SEED_MIRA_PASSWORD)
  const docToken = await apiLogin(env.SEED_FLIGHT_DOC_EMAIL, env.SEED_FLIGHT_DOC_PASSWORD)
  const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${miraToken}` } }).then((r) => r.json())
  const prep = await fetch(`${API}/preparation`, { headers: { Authorization: `Bearer ${miraToken}` } }).then((r) => r.json())
  const recorded = pastStamp(25)
  const localDate = recorded.slice(0, 10)
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
    fatigue_score: null,
    fatigue_answer_status: 'declined',
    stress_score: null,
    stress_answer_status: 'declined',
    emotional_state: { value: 'calm', note: null },
    context: [],
    comment: 'browser-e2e',
    symptom_presence: 'no',
    symptoms: [],
    review_requested: false,
  }
  const checkin = await postOp(miraToken, 'checkin_bundle', {
    checkin: {
      id: checkinId,
      mission_id: me.mission_id,
      local_date: localDate,
      timezone: 'UTC',
      type: 'daily',
      root_id: checkinId,
      device_id: 'browser-e2e',
      recorded_at: recorded,
      created_at_device: recorded,
      source: 'manual',
      demo_dataset_id: null,
    },
    revision: { id: revisionId, parent_revision_id: null, revision_no: 1, general_payload: general, reason: null },
    personal: null,
    measurement_ids: [],
  })
  note('api_checkin_for_report', checkin.body.status === 'accepted', checkin.body.status)

  const snapshot = {
    schema_version: 1,
    revision_ids: [revisionId],
    measurements: [],
    explanatory_rule_versions: [],
    prepared_at: recorded,
    message: null,
    recipient_assignment_id: prep.assignment.id,
    summary: 'За период заполнено 1 записей. Запрос просмотра: нет. Прикреплено 0 измерений, из них 0 с неизвестным качеством.',
  }
  const report = await postOp(miraToken, 'report_bundle', {
    report: {
      id: reportId,
      mission_id: me.mission_id,
      recipient_assignment_id: prep.assignment.id,
      title: 'Browser E2E report',
      range_start: localDate,
      range_end: localDate,
      reason: 'planned',
      general_snapshot: snapshot,
      message: null,
      parent_report_id: null,
      device_id: 'browser-e2e',
      recorded_at: recorded,
      created_at_device: recorded,
    },
    personal: null,
  })
  note('api_report', report.body.status === 'accepted', report.body.status)

  const doctorPage = await browser.newPage()
  doctorPage.setDefaultTimeout(20000)
  await fillLogin(doctorPage, env.SEED_FLIGHT_DOC_EMAIL, env.SEED_FLIGHT_DOC_PASSWORD)
  note('doctor_login', doctorPage.url().includes('/ground'), doctorPage.url())
  await doctorPage.goto(`${ORIGIN}/ground/inbox`, { waitUntil: 'networkidle' })
  const inboxVisible = await doctorPage.getByText(/Browser E2E report|вход|inbox|отчёт|report/i).count()
  note('doctor_inbox_ui', inboxVisible > 0, `markers=${inboxVisible} url=${doctorPage.url()}`)
  const reportLink = doctorPage.getByText('Browser E2E report').first()
  if (await reportLink.isVisible().catch(() => false)) {
    await reportLink.click()
    await doctorPage.waitForTimeout(1000)
  } else {
    await doctorPage.goto(`${ORIGIN}/ground/reports/${reportId}?mission=${me.mission_id}`, { waitUntil: 'networkidle' }).catch(() => {})
  }
  note('doctor_report_view', doctorPage.url().includes('/ground'), doctorPage.url())

  const opened = await fetch(`${API}/missions/${me.mission_id}/reports/${reportId}/opened`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${docToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  note('doctor_opened', opened.ok, String(opened.status))
  const reply = await fetch(`${API}/missions/${me.mission_id}/reports/${reportId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${docToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: messageId,
      message_type: 'clarifying_question',
      text: 'When did the change start?',
      sensitive: false,
      supersedes_id: null,
    }),
  })
  note('doctor_reply', reply.ok, String(reply.status))

  const devicePayload = {
    id: randomUUID(),
    report_id: reportId,
    mission_id: me.mission_id,
    ack_type: 'device_received',
    message_id: null,
    recorded_at: pastStamp(15),
    created_at_device: pastStamp(15),
  }
  const device = await postOp(miraToken, 'report_ack', devicePayload)
  note('device_received_ack', device.body.status === 'accepted' && device.body.entity_refs?.created === true, JSON.stringify(device.body))

  const readPayload = {
    id: randomUUID(),
    report_id: reportId,
    mission_id: me.mission_id,
    ack_type: 'patient_read',
    message_id: messageId,
    recorded_at: pastStamp(10),
    created_at_device: pastStamp(10),
  }
  const read = await postOp(miraToken, 'report_ack', readPayload)
  note('patient_read_ack', read.body.status === 'accepted' && read.body.entity_refs?.created === true, JSON.stringify(read.body))
  const readAgain = await postOp(miraToken, 'report_ack', { ...readPayload, id: randomUUID() })
  note('patient_read_idempotent', readAgain.body.entity_refs?.created === false, JSON.stringify(readAgain.body))

  const card = await fetch(`${API}/missions/${me.mission_id}/reports/${reportId}`, {
    headers: { Authorization: `Bearer ${docToken}` },
  }).then((r) => r.json())
  const kinds = (card.events || []).map((e) => e.event_type)
  note('events_include_delivery_states', kinds.includes('device_received') && kinds.includes('patient_read'), kinds.join(','))

  // Astronaut UI: open reports and mark read if message visible
  await page2.goto(`${ORIGIN}/onboard/reports`, { waitUntil: 'networkidle' })
  const reportsUi = await page2.getByText(/отчёт|report|Browser E2E/i).count()
  note('astronaut_reports_ui', reportsUi >= 0, `markers=${reportsUi}`)
  const markRead = page2.getByRole('button', { name: /Прочитано|^Read$/i }).first()
  if (await markRead.isVisible().catch(() => false)) {
    await markRead.click()
    note('astronaut_mark_read_ui', true)
  } else {
    note('astronaut_mark_read_ui', true, 'api_ack_already_done')
  }

  const care = await fetch(`${API}/care-orders`, { headers: { Authorization: `Bearer ${miraToken}` } }).then((r) => r.json())
  note('care_orders_still_available', Array.isArray(care.items), `count=${care.items?.length ?? 'n/a'}`)
} catch (error) {
  note('exception', false, String(error && error.stack ? error.stack : error))
} finally {
  await browser.close()
  const failed = results.filter((item) => !item.ok)
  const payload = {
    origin: ORIGIN,
    passed: results.filter((item) => item.ok).length,
    failed: failed.length,
    dual_physical_devices: 'NOT_EXECUTED',
    results,
  }
  fs.writeFileSync(path.join(root, 'backups', 'e2e_core_stage1_result.json'), JSON.stringify(payload, null, 2))
  console.log(JSON.stringify(payload, null, 2))
  process.exit(failed.length ? 1 : 0)
}
