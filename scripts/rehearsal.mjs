import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
)
const origin = 'http://localhost:4173'
const api = env.VITE_API_URL
const outDir = path.join(root, 'scripts', 'rehearsal-output')
fs.mkdirSync(outDir, { recursive: true })

const proof = { runs: [], rights: null, clocks: [], queue: null, a02: null }

const browser = await chromium.launch({ headless: true })
try {
  const astronaut = await browser.newContext()
  const physician = await browser.newContext()
  const probe = await browser.newContext()
  const board = await astronaut.newPage()
  const ground = await physician.newPage()
  board.setDefaultTimeout(20_000)
  ground.setDefaultTimeout(20_000)

  proof.a02 = await firstPrepareOffline(probe)
  await probe.close()

  await board.goto(`${origin}/login`)
  await signIn(board, env.SEED_MIRA_EMAIL, env.SEED_MIRA_PASSWORD)
  await board.waitForURL(/\/prepare/)
  await prepareDevice(board)
  await board.getByText('День миссии').waitFor()
  const missionDay = (await board.locator('header').innerText()).replace(/\s+/g, ' ')

  await ground.goto(`${origin}/login`)
  await signIn(ground, env.SEED_FLIGHT_DOC_EMAIL, env.SEED_FLIGHT_DOC_PASSWORD)
  await ground.waitForURL(/\/ground\/inbox/)
  proof.routes = { astronaut: board.url(), physician: ground.url() }

  await runScenario(board, ground, astronaut, 1, '2026-11-14T10:00', 'Плохое', '81')
  await runScenario(board, ground, astronaut, 2, '2026-11-14T10:20', 'Среднее', '86')
  proof.clocks.push({ missionDay, sameOnSecondRun: proof.runs[1].missionDay === missionDay })

  const mira = await token(env.SEED_MIRA_EMAIL, env.SEED_MIRA_PASSWORD)
  const alex = await token(env.SEED_ALEX_EMAIL, env.SEED_ALEX_PASSWORD)
  const prepared = await apiJson('/preparation', mira)
  proof.rights = []
  for (const checkin of prepared.history.checkins) {
    const denied = await fetch(`${api}/missions/${prepared.mission.id}/checkins/${checkin.id}`, {
      headers: { Authorization: `Bearer ${alex}` },
    })
    const allowed = await fetch(`${api}/missions/${prepared.mission.id}/checkins/${checkin.id}`, {
      headers: { Authorization: `Bearer ${mira}` },
    })
    proof.rights.push({
      id: checkin.id,
      alex: denied.status,
      mira: allowed.status,
      timezone: checkin.timezone,
      localDate: checkin.local_date,
      recordedAt: checkin.recorded_at,
    })
  }
  proof.datasetBeforeFresh = prepared.mission.demo_dataset_id

  await board.goto(`${origin}/onboard/profile`)
  await board.getByLabel('Введите ОЧИСТИТЬ').fill('ОЧИСТИТЬ')
  const clearButton = board.getByRole('button', { name: 'Очистить локальный профиль' })
  proof.queue = { clearEnabledAfterDelivery: await clearButton.isEnabled() }
  if (await clearButton.isEnabled()) await clearButton.click()

  fs.writeFileSync(path.join(outDir, 'proof.json'), JSON.stringify(proof, null, 2))
  console.log(JSON.stringify(proof, null, 2))
} catch (error) {
  fs.writeFileSync(path.join(outDir, 'proof.json'), JSON.stringify({ proof, error: String(error) }, null, 2))
  throw error
} finally {
  await browser.close()
}

async function runScenario(board, ground, context, run, recordedAt, overall, pulse) {
  const comment = `Прогон ${run}. Связь с Землёй недоступна.`
  await setApi(context, false)
  await board.reload()
  await board.getByText('Нет связи с сервером').waitFor()
  await board.getByRole('heading', { name: 'Сегодня' }).waitFor()
  const missionDay = (await board.locator('header').innerText()).replace(/\s+/g, ' ')

  await board.goto(`${origin}/onboard/checkin/new?mode=daily&fresh=1`)
  const draftChoice = board.getByRole('button', { name: 'Удалить черновик' })
  if (await draftChoice.isVisible().catch(() => false)) await draftChoice.click()
  await board.locator('#recordedAtLocal').fill(recordedAt)
  await board.locator('#sleepHours').fill(run === 1 ? '6' : '5.5')
  await radio(board, 'Общее самочувствие', overall)
  await score(board, 'Качество сна', '3')
  await score(board, 'Усталость сейчас', '7')
  await score(board, 'Стресс сейчас', 'Не оценивать')
  await radio(board, 'Эмоциональное состояние', 'Напряжённое')
  await board.locator('#comment').fill(comment)
  await board.getByRole('button', { name: 'Продолжить' }).click()
  await board.getByText('Есть ли симптомы').waitFor()
  await board.getByRole('button', { name: 'Назад' }).click()
  const sleepKept = await board.locator('#sleepHours').inputValue()
  await board.getByRole('button', { name: 'Продолжить' }).click()
  await radio(board, 'Есть ли симптомы, которые вы хотите отметить?', 'Нет')
  await radio(board, 'Хотите, чтобы врач обратил внимание на эту запись?', 'Нет')
  await board.getByRole('button', { name: 'Продолжить' }).click()
  await radio(board, 'Хотите заполнить раздел сегодня?', 'Да')
  await radio(board, 'Кровянистые выделения сегодня', 'Нет')
  await radio(board, 'Доступ к этому разделу', 'Только это устройство')
  await board.getByRole('button', { name: 'Продолжить' }).click()
  await board.getByRole('link', { name: 'Новое измерение' }).click()
  await board.getByRole('heading', { name: 'СИМУЛЯЦИЯ' }).waitFor()
  await board.getByText('Симулятор не создаёт измерение').waitFor()
  await board.locator('#metric').selectOption('heart_rate')
  await board.locator('#rawValue').fill(pulse)
  await board.getByRole('button', { name: 'Сохранить измерение' }).click()
  await board.getByText('Измерение сохранено на устройстве').waitFor()
  await board.goto(`${origin}/onboard/checkin/new`)
  if (await draftChoice.isVisible().catch(() => false)) await board.getByRole('button', { name: 'Продолжить черновик' }).click()
  if (await board.getByText('Измерения необязательны').isVisible().catch(() => false)) {
    await board.getByRole('button', { name: 'Продолжить' }).click()
  }
  await board.getByText('Только на этом устройстве').waitFor()
  await board.getByText('Персональный раздел').waitFor()
  await board.locator('button[type="submit"]').evaluate((button) => {
    button.click()
    button.click()
  })
  await board.getByRole('heading', { name: 'Запись сохранена на устройстве' }).waitFor()
  await board.getByText('Ожидает передачи').waitFor()

  await board.getByRole('navigation', { name: 'Меню' }).getByRole('link', { name: 'Настройки' }).click()
  await board.getByText(/Очистка заблокирована/).waitFor()
  await board.getByLabel('Введите ОЧИСТИТЬ').fill('ОЧИСТИТЬ')
  const blocked = await board.getByRole('button', { name: 'Очистить локальный профиль' }).isDisabled()

  const copies = await countComment(board, comment)
  await board.goto(`${origin}/onboard/history`)
  await board.reload()
  await board.getByRole('link', { name: /Ежедневная/ }).filter({ hasText: recordedAt.slice(11, 16) }).first().click()
  await board.getByText(comment).waitFor()
  await board.getByText('UTC').waitFor()

  await board.goto(`${origin}/onboard/reports`)
  await board.getByRole('link', { name: 'Создать отчёт' }).click()
  await board.getByText('Персональный раздел в этот отчёт не входит').waitFor()
  await board.getByText('Flight-Doc').waitFor()
  const recordBoxes = board.locator('fieldset', { has: board.getByRole('legend', { name: 'Отчёты' }) }).locator('input[type="checkbox"]')
  for (const box of await recordBoxes.all()) {
    if (!(await box.isChecked())) await box.check()
  }
  await board.getByRole('button', { name: 'Сохранить и поставить в очередь' }).click()
  const reportUrl = board.url()

  await setApi(context, true)
  await board.goto(`${origin}/onboard/sync`)
  await board.getByRole('button', { name: 'Синхронизировать сейчас' }).click()
  await board.goto(reportUrl)
  await board.getByText(/Получен сервером ·/).waitFor({ timeout: 30_000 })

  await ground.getByRole('button', { name: 'Обновить' }).click()
  const card = ground.getByRole('link', { name: /Самочувствие/ }).first()
  await card.waitFor({ timeout: 20_000 })
  await card.click()
  await ground.getByText('opened').waitFor()
  await ground.locator('#reply-text').fill(`Прогон ${run}: когда началось изменение?`)
  await ground.getByRole('button', { name: 'Отправить ответ' }).click()
  await ground.getByText('Сохранён на сервере').waitFor()

  await board.reload()
  await board.getByText(/Открыт врачом ·/).waitFor({ timeout: 20_000 })
  await board.getByText(/Ответ доставлен ·/).waitFor()
  await board.getByRole('button', { name: 'Ответы' }).click()
  await board.getByText(`Прогон ${run}: когда началось изменение?`).waitFor()

  proof.runs.push({ run, missionDay, sleepKept, blockedClear: blocked, commentCopies: copies, reportUrl, recordedAt, pulse })
}

async function firstPrepareOffline(context) {
  await setApi(context, true)
  const page = await context.newPage()
  await setApi(context, false)
  await page.goto(`${origin}/login`)
  await signIn(page, env.SEED_MIRA_EMAIL, env.SEED_MIRA_PASSWORD)
  const text = await page.locator('body').innerText()
  const blocked = text.includes('Нет связи с сервером') && !text.includes('Начать работу')
  await page.close()
  return { blocked, noFakeReady: !text.includes('Начать работу') }
}

async function prepareDevice(page) {
  await page.getByText('Mira-01').waitFor()
  await page.getByRole('checkbox', { name: 'Это мои данные' }).check()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await page.getByRole('checkbox', { name: 'Передавать завершённые общие записи назначенному врачу' }).check()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await page.getByRole('button', { name: 'Загрузить и проверить' }).click()
  const start = page.getByRole('button', { name: 'Начать работу' })
  await start.waitFor()
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Начать работу'))
    return button && !button.disabled
  })
  await start.click()
  await page.waitForURL(/\/onboard\/today/)
}

async function signIn(page, email, password) {
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

async function setApi(context, online) {
  await context.unroute('http://localhost:8000/**').catch(() => {})
  if (!online) await context.route('http://localhost:8000/**', (route) => route.abort())
}

async function radio(page, name, choice) {
  await page.getByRole('radiogroup', { name }).getByRole('radio', { name: choice, exact: true }).click()
}

async function score(page, name, choice) {
  await page.getByRole('group', { name }).getByRole('button', { name: choice, exact: true }).click()
}

async function countComment(page, comment) {
  return page.evaluate(async (needle) => {
    const open = indexedDB.open('artemia-journal')
    const database = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const rows = await new Promise((resolve, reject) => {
      const request = database.transaction('localCheckinRevisions', 'readonly').objectStore('localCheckinRevisions').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return rows.filter((row) => row.general_payload?.comment === needle).length
  }, comment)
}

async function token(email, password) {
  const response = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`login failed ${response.status}`)
  return (await response.json()).access_token
}

async function apiJson(pathname, access) {
  const response = await fetch(`${api}${pathname}`, { headers: { Authorization: `Bearer ${access}` } })
  if (!response.ok) throw new Error(`${pathname} ${response.status}`)
  return response.json()
}
