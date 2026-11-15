/**
 * Capture presentation screenshots for Artemia (Mira-01 / ORBIT-DEMO-01).
 * English UI. Main shots are online with filled+sent data.
 * Offline pair stops the API container so the outbox queue is visible.
 */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = join(process.cwd(), 'docs', 'presentation-screenshots')
const MIRA = {
  email: process.env.SEED_MIRA_EMAIL ?? 'mira@artemia.local',
  password: process.env.SEED_MIRA_PASSWORD ?? '123',
}
const DOC = {
  email: process.env.SEED_FLIGHT_DOC_EMAIL ?? 'doc@artemia.local',
  password: process.env.SEED_FLIGHT_DOC_PASSWORD ?? '123',
}

mkdirSync(OUT, { recursive: true })

function sh(command) {
  console.log('>', command)
  execSync(command, { stdio: 'inherit', cwd: process.cwd(), shell: true })
}

async function waitApi(up, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:8000/health')
      if (up && res.ok) return
      if (!up) {
        // still up
      } else {
        return
      }
    } catch {
      if (!up) return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (up) throw new Error('API did not become healthy')
}

async function patchPreparedLocale(page) {
  await page.evaluate(async () => {
    document.documentElement.lang = 'en'
    try {
      const names = (await indexedDB.databases()).map((d) => d.name).filter(Boolean)
      const dbName = names.find((n) => /artemia/i.test(String(n))) ?? 'artemia-journal'
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      if (![...db.objectStoreNames].includes('preparedProfiles')) {
        db.close()
        return
      }
      await new Promise((resolve) => {
        const tx = db.transaction('preparedProfiles', 'readwrite')
        const store = tx.objectStore('preparedProfiles')
        const req = store.getAll()
        req.onsuccess = () => {
          for (const row of req.result ?? []) store.put({ ...row, locale: 'en' })
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
      db.close()
    } catch {
      /* ignore */
    }
  })
}

async function ensureEnglish(page) {
  const en = page.locator('button', { hasText: /^EN$/ })
  const hasEn = (await en.count()) > 0 && (await en.first().isVisible().catch(() => false))
  if (hasEn) {
    const pressed = await en.first().getAttribute('aria-pressed').catch(() => null)
    if (pressed !== 'true') {
      await en.first().click({ timeout: 5000 })
      await page.waitForTimeout(400)
    }
  }
  await patchPreparedLocale(page)
  if (await page.getByRole('link', { name: 'Сегодня' }).isVisible().catch(() => false)) {
    if ((await en.count()) > 0) await en.first().click({ timeout: 5000 }).catch(() => {})
    await page.getByRole('link', { name: 'Today' }).waitFor({ state: 'visible', timeout: 8000 })
  }
}

async function clearAppData(page) {
  await page.goto(`${BASE}/login`)
  await page.evaluate(async () => {
    sessionStorage.clear()
    localStorage.clear()
    try {
      const names = (await indexedDB.databases()).map((d) => d.name).filter(Boolean)
      await Promise.all(
        names.map(
          (name) =>
            new Promise((resolve) => {
              const req = indexedDB.deleteDatabase(name)
              req.onsuccess = () => resolve()
              req.onerror = () => resolve()
              req.onblocked = () => resolve()
            }),
        ),
      )
    } catch {
      /* ignore */
    }
  })
}

async function login(page, account) {
  await page.goto(`${BASE}/login`)
  await page.locator('button', { hasText: /^EN$/ }).first().click()
  await page.waitForTimeout(300)
  await page.getByLabel(/Email|Электронная почта/i).fill(account.email)
  await page.getByLabel(/Password|Пароль/i).fill(account.password)
  await page.getByRole('button', { name: /Sign in|Войти/i }).click()
  await page.waitForURL(/\/(prepare|onboard|ground)/, { timeout: 20000 })
}

async function prepareDevice(page) {
  if (!page.url().includes('/prepare')) return
  await page.getByLabel(/These are my details|Это мои данные/i).check()
  await page.getByRole('button', { name: /Continue|Продолжить/i }).click()
  await page.getByRole('button', { name: 'UTC' }).click()
  const exchange = page.getByLabel(/Share completed general|Передавать завершённые общие записи/i)
  if (!(await exchange.isChecked())) await exchange.check()
  await page.getByRole('button', { name: /Continue|Продолжить/i }).click()
  await page.getByRole('button', { name: /Load and check|Загрузить и проверить/i }).click()
  const start = page.getByRole('button', { name: /Start|Начать работу/i })
  await start.waitFor({ state: 'visible', timeout: 30000 })
  for (let i = 0; i < 30; i += 1) {
    if (await start.isEnabled()) break
    await page.waitForTimeout(500)
  }
  await start.click()
  await page.waitForURL(/\/onboard\/today/, { timeout: 20000 })
  await ensureEnglish(page)
}

async function shot(page, name) {
  const path = join(OUT, name)
  await page.screenshot({ path, fullPage: false })
  console.log('saved', path)
}

async function clickContinue(page) {
  const cont = page.getByRole('button', { name: /Continue →|Continue/i }).last()
  if (await cont.isEnabled().catch(() => false)) await cont.click()
  await page.waitForTimeout(500)
}

async function synchronizeNow(page) {
  await page.goto(`${BASE}/onboard/sync`)
  await ensureEnglish(page)
  await page.waitForTimeout(400)
  const sync = page.getByRole('button', { name: /Synchronize now/i })
  if (await sync.isVisible().catch(() => false)) {
    await sync.click()
    await page.waitForTimeout(2500)
  }
}

async function saveMeasurement(page, { value = '72', note, shotName } = {}) {
  await page.goto(`${BASE}/onboard/measurements`)
  await ensureEnglish(page)
  await page.getByRole('button', { name: /Save measurement/i }).waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('#metric').selectOption('heart_rate')
  await page.locator('#rawValue').fill(String(value))
  await page.locator('#context').selectOption('rest')
  await page.locator('#instrument').fill('ESP32 + MAX30102 · interface demo')
  await page.locator('#note').fill(note ?? 'Interface demonstration. Source: manual entry / prototype simulation.')
  if (shotName) await shot(page, shotName)
  await page.getByRole('button', { name: /Save measurement/i }).click()
  await page.waitForTimeout(1000)
}

async function fillAndSaveCheckin(page, { personalShot } = {}) {
  await page.goto(`${BASE}/onboard/checkin/new?mode=daily&fresh=1`)
  await ensureEnglish(page)
  await page.waitForTimeout(700)
  const deleteDraft = page.getByRole('button', { name: /Delete the draft|Delete draft/i })
  if (await deleteDraft.isVisible().catch(() => false)) {
    await deleteDraft.click()
    await page.waitForTimeout(500)
  }

  const personalToggle = page.getByLabel(/Show menstrual/i)
  if ((await personalToggle.count()) && !(await personalToggle.isChecked())) await personalToggle.check()

  await page.getByRole('radio', { name: /^Good$/i }).click({ timeout: 15000 })
  const ranges = page.locator('input[type="range"]')
  if ((await ranges.count()) >= 1) {
    await ranges.nth(0).fill('3')
    await ranges.nth(0).dispatchEvent('input')
  }
  if ((await ranges.count()) >= 2) {
    await ranges.nth(1).fill('2')
    await ranges.nth(1).dispatchEvent('input')
  }
  await page.getByRole('radio', { name: /Calm/i }).first().click()
  await page.locator('#comment').fill('Mild fatigue after EVA prep. Demo record for ORBIT-DEMO-01.').catch(() => {})
  await clickContinue(page)

  // Sleep
  const sleepUnknown = page.getByLabel(/I don't know|Don't know|sleep unknown|Sleep duration unknown/i).first()
  if (await sleepUnknown.count()) await sleepUnknown.check().catch(() => {})
  else {
    const sleepSkip = page.getByText(/I don't know|Don't know|Unknown/i).first()
    if (await sleepSkip.isVisible().catch(() => false)) {
      await page.locator('label').filter({ hasText: /I don't know|Don't know/i }).locator('input').check().catch(() => {})
    }
  }
  for (const name of [/Do not rate/i, /Skip rating/i]) {
    const btns = page.getByRole('button', { name })
    const n = await btns.count()
    for (let i = 0; i < Math.min(n, 8); i += 1) await btns.nth(i).click().catch(() => {})
  }
  const sleepSkipBoxes = page.locator('label').filter({ hasText: /Do not rate|Skip|I don't know/i }).locator('input[type="checkbox"]')
  const boxCount = await sleepSkipBoxes.count()
  for (let i = 0; i < boxCount; i += 1) {
    const box = sleepSkipBoxes.nth(i)
    if (!(await box.isChecked().catch(() => true))) await box.check().catch(() => {})
  }
  await clickContinue(page)

  // Nutrition skip
  const skipNutrition = page.getByRole('button', { name: /^Skip$/i }).first()
  if (await skipNutrition.isVisible().catch(() => false)) await skipNutrition.click()
  await clickContinue(page)

  // Symptoms: no symptoms + physician attention required
  await page.getByRole('radiogroup', { name: /Are there symptoms/i }).getByRole('radio', { name: /^No$/i }).click()
  await page.getByRole('radiogroup', { name: /physician to look/i }).getByRole('radio', { name: /^Yes$/i }).click()
  await page.waitForTimeout(300)
  await clickContinue(page)

  // Personal
  await page.getByRole('heading', { name: /^Personal$/i }).waitFor({ state: 'visible', timeout: 15000 })
  const fillIn = page.getByRole('button', { name: /^Fill in$/i }).first()
  await fillIn.waitFor({ state: 'visible', timeout: 8000 })
  await fillIn.click()
  await page.getByRole('radiogroup', { name: /Bleeding today/i }).waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(300)
  await page.getByRole('radiogroup', { name: /Bleeding today/i }).getByRole('radio', { name: /^No$/i }).click()
  await page.getByRole('radiogroup', { name: /expected for you/i }).getByRole('radio', { name: /I do not know/i }).click()
  await page.getByRole('button', { name: /Do not rate/i }).first().click().catch(() => {})
  await page.getByRole('radiogroup', { name: /Effect on usual activities/i }).getByRole('radio', { name: /No effect/i }).click()
  await page.getByRole('radiogroup', { name: /Cycle context/i }).getByRole('radio', { name: /Natural cycle/i }).click()
  await page.getByRole('radiogroup', { name: /Access to this section/i }).getByRole('radio', { name: /This device only/i }).click()
  await page.locator('#personalComment').fill('Optional personal note kept on device only. Demo.').catch(() => {})
  if (personalShot) {
    const access = page.getByRole('radiogroup', { name: /Access to this section/i })
    await access.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await shot(page, personalShot)
  }
  await clickContinue(page)

  // Measurements step in check-in: skip
  await page.waitForTimeout(400)
  const skipMeasure = page.getByRole('button', { name: /^Skip$/i }).first()
  if (await skipMeasure.isVisible().catch(() => false)) await skipMeasure.click()
  await clickContinue(page)

  // Review → Save record
  for (let i = 0; i < 5; i += 1) {
    const save = page.getByRole('button', { name: /Save record/i })
    if (await save.isVisible().catch(() => false)) {
      await save.click()
      break
    }
    const errors = page.getByText(/Check the fields/i)
    if (await errors.isVisible().catch(() => false)) {
      console.log('validation still open on step', await page.locator('h2').first().innerText().catch(() => '?'))
      await shot(page, 'zz-checkin-validation.png')
      throw new Error('check-in validation blocked save')
    }
    await clickContinue(page)
  }
  await page
    .getByText(/Record saved on this device|Waiting to be sent|Stored only on this device/i)
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
  const prepareReport = page.getByRole('button', { name: /Prepare (a )?report|Prepare report/i })
  if (await prepareReport.isVisible().catch(() => false)) {
    await prepareReport.click()
  } else {
    await page.goto(`${BASE}/onboard/reports/new`)
  }
  await page.waitForTimeout(800)
}

async function createAndSendReport(page) {
  await ensureEnglish(page)
  // Select all checkins / measurements
  const checks = page.locator('fieldset input[type="checkbox"]')
  const n = await checks.count()
  for (let i = 0; i < n; i += 1) {
    const box = checks.nth(i)
    if (!(await box.isChecked().catch(() => true))) await box.check().catch(() => {})
  }
  await page.locator('select').filter({ has: page.locator('option[value="review_request"]') }).selectOption('review_request').catch(async () => {
    await page.locator('select').first().selectOption({ label: /Please review|review/i }).catch(() => {})
  })
  // Fallback: any select with pleaseReview
  const reason = page.locator('select').nth(0)
  await reason.selectOption('review_request').catch(() => {})
  await page.locator('#report-message').fill(
    'Please review today\'s resting heart rate (72 bpm) and mild fatigue note. Demo ORBIT-DEMO-01 / Mira-01.',
  )
  const saveBtn = page.getByRole('button', { name: /Save and queue|Save on this device only/i })
  await saveBtn.click()
  await page.waitForTimeout(1500)
}

async function openPreparedAsMira(page) {
  await page.goto(`${BASE}/login`)
  await page.locator('button', { hasText: /^EN$/ }).first().click()
  await page.waitForTimeout(300)
  const openPrepared = page.getByRole('button', { name: /Open the prepared journal/i })
  if (await openPrepared.isVisible().catch(() => false)) {
    await openPrepared.click()
    await page.waitForURL(/\/onboard/, { timeout: 15000 })
  } else {
    await login(page, MIRA)
    if (page.url().includes('/prepare')) await page.goto(`${BASE}/onboard/today`)
  }
  await ensureEnglish(page)
}

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--disable-dev-shm-usage'],
})
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
  deviceScaleFactor: 1,
})
const page = await context.newPage()

try {
  await waitApi(true)
  await clearAppData(page)

  // --- Build online story data as Mira ---
  await login(page, MIRA)
  await prepareDevice(page)

  // Measurement first (online), keep form shot for slide 03
  await saveMeasurement(page, {
    value: '72',
    shotName: '03-measurement-esp32-demo.png',
    note: 'Interface demonstration. Source: manual entry / prototype simulation. Resting HR for Mira-01.',
  })
  await synchronizeNow(page)

  // Check-in with personal shot, then save
  await fillAndSaveCheckin(page, { personalShot: '02-checkin-personal.png' })
  await synchronizeNow(page)

  // Report to physician (after entities are synced so send is allowed)
  await page.goto(`${BASE}/onboard/reports/new`)
  await page.waitForTimeout(800)
  await createAndSendReport(page)
  await synchronizeNow(page)

  // 01 Today with filled/sent state (captured again after care plan + sync below too)
  await page.goto(`${BASE}/onboard/today`)
  await ensureEnglish(page)
  await page.getByRole('link', { name: 'Today' }).waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(800)

  // --- Doctor: open report + create care plan ---
  await context.clearCookies()
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.clear()
  })
  await login(page, DOC)
  await page.waitForURL(/\/ground/, { timeout: 20000 }).catch(() => {})
  if (!page.url().includes('/ground')) await page.goto(`${BASE}/ground/inbox`)
  await page.locator('button', { hasText: /^EN$/ }).first().click().catch(() => {})
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /Refresh/i }).click().catch(() => {})
  await page.waitForTimeout(1000)

  // Open first report (marks opened) — richest doctor view for the story
  const reportLink = page.locator('a[href*="/ground/reports/"]').first()
  if (await reportLink.count()) {
    await reportLink.click()
    await page.waitForTimeout(1500)
    await page.locator('button', { hasText: /^EN$/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await shot(page, '04-doctor-crew-card.png')
  } else {
    await shot(page, '04-doctor-crew-card.png')
  }

  // Patient card → Physician tasks tab → create observation plan
  const crewHref = await page.getByRole('link', { name: /Patient card/i }).first().getAttribute('href').catch(() => null)
  if (crewHref) {
    await page.goto(`${BASE}${crewHref.startsWith('http') ? new URL(crewHref).pathname + new URL(crewHref).search : crewHref}`)
  } else {
    await page.getByRole('link', { name: /Patient card/i }).first().click().catch(() => {})
  }
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /^Physician tasks$/i }).click()
  await page.locator('#care-title').waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('#care-kind').selectOption('measurement')
  await page.locator('#care-title').fill('Repeat resting heart-rate measurement')
  await page.locator('#care-goal').fill("Confirm resting HR after today's 72 bpm reading")
  await page.locator('#care-instructions').fill(
    'In 2 hours, repeat resting heart-rate measurement with ESP32 + MAX30102 and save the result. Not a medication prescription.',
  )
  await page.locator('#care-schedule').fill('Today, in 2 hours')
  await page.locator('#care-start').fill('2026-11-15T10:00')
  await page.locator('#care-due').fill('2026-11-15T18:00')
  await page.getByRole('button', { name: /Create a task/i }).click()
  await page.getByText(/Repeat resting heart-rate measurement/i).first().waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(800)

  // --- Mira receives care plan ---
  await context.clearCookies()
  await page.evaluate(() => {
    sessionStorage.clear()
  })
  await openPreparedAsMira(page)
  await synchronizeNow(page)
  await page.goto(`${BASE}/onboard/orders`)
  await ensureEnglish(page)
  await page.getByText(/Repeat resting heart-rate measurement/i).first().waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(800)
  await shot(page, '05-care-plan-pulse-rest.png')

  // Online Today with task + measurement visible
  await page.goto(`${BASE}/onboard/today`)
  await ensureEnglish(page)
  await page.waitForTimeout(1000)
  const latest = page.getByText(/Latest measurement|Heart rate|72|bpm|Tasks for today|Repeat resting/i).first()
  if (await latest.isVisible().catch(() => false)) await latest.scrollIntoViewIfNeeded().catch(() => {})
  await shot(page, '01-today-mira.png')

  // --- Offline pair: stop API, queue a new measurement, show queue ---
  sh('docker compose stop api')
  await waitApi(false)

  await saveMeasurement(page, {
    value: '74',
    note: 'Offline capture while API container is stopped. Queued for later delivery.',
  })

  await page.goto(`${BASE}/onboard/sync`)
  await ensureEnglish(page)
  await page.getByRole('button', { name: /Check the link/i }).click().catch(() => {})
  await page.waitForTimeout(1500)
  const hide = page.getByLabel(/Hide accepted/i)
  await page.getByText(/Waiting to send|Queued: [1-9]/i).first().waitFor({ state: 'visible', timeout: 10000 })
  const queueItem = page.getByText(/Measurement/i).first()
  if (await queueItem.isVisible().catch(() => false)) await queueItem.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(400)
  await shot(page, '06a-offline-queue.png')

  sh('docker compose start api')
  await waitApi(true)
  // Session may have been marked closed while API was down — sign in again, keep IndexedDB.
  await login(page, MIRA)
  if (page.url().includes('/prepare')) await page.goto(`${BASE}/onboard/today`)
  await ensureEnglish(page)
  await page.goto(`${BASE}/onboard/sync`)
  await ensureEnglish(page)
  await page.getByRole('button', { name: /Check the link/i }).click().catch(() => {})
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /Synchronize now/i }).click()
  await page.waitForTimeout(3500)
  if (await hide.isChecked().catch(() => false)) await hide.uncheck().catch(() => {})
  await page.waitForTimeout(600)
  await page.getByText(/Accepted|Delivered|accepted/i).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  await shot(page, '06b-online-delivered.png')

  console.log('Done. Files in', OUT)
} catch (error) {
  console.error(error)
  try {
    sh('docker compose start api')
  } catch {
    /* ignore */
  }
  await shot(page, 'zz-error-state.png')
  process.exitCode = 1
} finally {
  try {
    sh('docker compose start api')
  } catch {
    /* ignore */
  }
  await browser.close()
}
