# AUDIT_REPORT — OrbitCare / Artemia

Дата исходного аудита: **2026-11-15**.  
Дата Stage-1 (исправления CORE): **2026-11-15** (UTC ≈ 2026-11-14T19:50Z локально UTC+5).  
Источник требований: `docs/OrbitCare_Cursor_Functional_Audit.md` v1.0.

**Легенда статусов (строго по типу доказательства):**

| Метка | Значение |
|---|---|
| **PASS unit** | `yarn test` / доменный unit |
| **PASS API** | `pytest` и/или live HTTP к demo API |
| **PASS browser E2E** | Playwright против `yarn build` + `yarn preview` на фиксированном origin |
| **PASS dual-device** | Два физических устройства |
| **PARTIAL** | Часть пути подтверждена, полного сценария нет |
| **CODE_ONLY** | Только чтение кода / отсутствие поведенческой проверки |
| **FAIL / NOT_IMPLEMENTED / BLOCKED** | Как раньше |

**Правило:** статус **не** повышается до PASS только по чтению кода.

---

## 0. Stage-1: снимок окружения (без секретов)

| Параметр | Значение |
|---|---|
| Git HEAD | `d8a6294b5ec3c377f2cea552bc0b831338f7cb88` |
| API image | `artemia-nasa-api:latest` / `7a917f8801d6` (пересобран из актуальных исходников) |
| DB image | `postgres:16` / `80dee66a0ba9` |
| Alembic demo-БД | `20261115_0003 (head)` |
| Резервная копия | `backups/demo_pg_20261115_005027.dump` (+ `.meta.txt`); volumes **не** удалялись, БД **не** сбрасывалась |
| Frontend prod origin | `http://localhost:4173` (CORS demo API: `localhost:4173`, не `127.0.0.1`) |
| Preview | `yarn preview --host localhost --port 4173` |
| Seed credentials | из контейнера → `backups/e2e.env` (gitignore); host `.env` у Flight-Doc может отличаться из‑за `#` в значении |

Миграции Stage-1: `20261115_0002_care_orders`, `20261115_0003_report_ack` (`private.sync_receipts` + `report_ack`).

---

## 1. Фактический стек и команды

| Слой | Факт |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8, Dexie, Zod, React Router |
| Backend | FastAPI, JWT, `POST /operations` |
| БД | PostgreSQL 16, Alembic |
| Локально | IndexedDB outbox + receipts; `report_ack` → server events |

**Команды Stage-1 (фактически):**

```text
docker compose up --build -d
docker compose exec -T api alembic current          → 20261115_0003 (head)
yarn build
yarn preview --host localhost --port 4173
yarn test                                           → 66 passed
cd backend && .venv\Scripts\python -m pytest -q     → 34 passed
node scripts/e2e_api_receipts.mjs                   → ok=true
node scripts/e2e_core_stage1.mjs                    → 22/22 PASS
```

Live smoke care-orders: OpenAPI содержит `/care-orders`, `/ground/crew/{subject_id}/orders`, revise/cancel; `GET /care-orders` → 200, items≥1.

---

## 2. Что удалось запустить; ограничения

| Проверка | Слой | Результат |
|---|---|---|
| `GET /health` | API live | `{"status":"ok"}` |
| Care-orders routes + board | API live | **есть** (после rebuild) |
| `yarn test` | unit | **66 passed** (в т.ч. care-refresh не блокирует outbox) |
| `pytest -q` | API | **34 passed** (в т.ч. `test_report_ack.py`) |
| API receipts E2E | API live | checkin→report→opened→reply→`device_received`→`patient_read` (+ idempotent `created:false`) |
| Browser CORE E2E | browser | login/prepare/checkin/offline/sync/doctor inbox+report/acks — **22 PASS** |
| Два физических устройства | dual-device | **NOT_EXECUTED** |
| ADMIN / COMMAND / USB | — | **не расширялись** в Stage-1 |

---

## 3. Исправления Stage-1 (продуктовый код)

| Проблема | Исправление | Доказательство |
|---|---|---|
| Live API без care-orders | Rebuild + migrate `0002` | OpenAPI + board 200 |
| `patient_read` только локально | Операция `report_ack` (`device_received` / `patient_read`), серверные `ReportEvent`, идемпотентность по типу события | `test_report_ack.py`; live E2E events |
| Care refresh мог ломать sync | try/catch вокруг refresh; независимый outbox | unit: `care-order refresh failure does not block outbox acceptance` |
| CORS vs origin | E2E/preview на `http://localhost:4173` | browser login PASS (на `127.0.0.1` — CORS fail) |

---

## 4. Матрица FLOW (обновление Stage-1)

| ID | Уровень | Статус | Доказательство по слоям |
|---|---|---|---|
| FLOW-01 | ADMIN | NOT_IMPLEMENTED | UI/API admin нет; Stage-1 не трогал |
| FLOW-02 | CORE | **PASS browser E2E** (+ unit) | `e2e_core_stage1`: checkin без personal |
| FLOW-03 | CORE | **PASS unit/API** + **PARTIAL browser** | stage4 tests; browser local_only personal сохранён на устройстве |
| FLOW-04 | CORE | PASS API/unit | access/stage4; browser чужой доступ не гонялся |
| FLOW-05 | CORE | **PASS browser E2E** (1 устройство); dual-device **NOT_EXECUTED** | offline API-block → fill/save → reopen → sync markers |
| FLOW-06 | CORE | **PASS API** + **PASS browser E2E** (гибрид UI+API ack) | doctor UI inbox/report; reply/opened/device_received/patient_read live; UI «Прочитано» после API ack |
| FLOW-07…08 | PLAN | PARTIAL | live routes есть; draft/publish/occurrence нет |
| FLOW-09 | DEVICE | NOT_IMPLEMENTED | USB stub |
| FLOW-10 | CORE | PASS API/unit; browser revise **не** отдельным шагом | stage4 |
| FLOW-11 | CORE/ADMIN | PARTIAL | revoke tests; смена врача UI нет |
| FLOW-12 | COMMAND | NOT_IMPLEMENTED | нет `/command` |
| FLOW-13 | CORE | PASS unit/API | delivery + operations |
| FLOW-14 | CORE | PASS unit | delivery 401/чужой user |
| FLOW-15 | ADMIN | NOT_IMPLEMENTED | нет mission status |

---

## 5. PLAN-01…PLAN-12 (коррекция завышенных статусов)

| ID | Было | Стало | Почему |
|---|---|---|---|
| PLAN-01 | PASS | **PASS API** (pytest); live create path есть | Не browser E2E полного PLAN |
| PLAN-02 | PASS | **PASS unit/API** | Нет medication в kinds |
| PLAN-03 | FAIL | FAIL | draft по‑прежнему нет |
| PLAN-04 | PARTIAL | PARTIAL | нет publish-оси |
| PLAN-05 | PASS | **PASS unit/API** | — |
| PLAN-06 | CODE_ONLY/BLOCKED | **PARTIAL** | live board работает; полный offline execute E2E не закрыт |
| PLAN-07…09 | PARTIAL / N/I | без изменения | — |
| PLAN-10 | **PASS (код)** ← завышен | **CODE_ONLY / PARTIAL** | UI-строка «срок прошёл» есть; нет browser/API сценария overdue≠done/тревога |
| PLAN-11 | PASS | **PASS unit/API** | schema response |
| PLAN-12 | **PASS** ← завышен | **PASS API (ownership)** / **PARTIAL** | `order_not_owned` в pytest; связь `measurement_id` и чужой mission E2E **не** закрыты |

---

## 6. A01–A50 — точечные правки доказательств

| ID | Было | Стало | Комментарий |
|---|---|---|---|
| **A03** | PASS R (unit IndexedDB) ← завышен как полный offline | **PASS unit** + **PASS browser E2E** (reload today после prepare на prod preview) | Dual-device всё ещё нет |
| A04 / A05 | PARTIAL | **PASS browser E2E** (offline fill/save + close/reopen вкладки в одном browser context) | Не два телефона |
| A12 | PASS R | PASS unit/API + browser personal local_only save | Содержимое personal не уходило в API-часть E2E |
| A27 | PASS R | PASS unit (расширен: care-refresh failure) | — |
| A31/A32 | PASS R | + live events `accepted,opened,replied,device_received,patient_read` | API E2E |
| A44–A48 | N/I | N/I | USB не трогали |
| A49 | PASS API pytest | PASS API pytest | demo seed без commander/admin |
| A50 | N/I | N/I | нет SW |

Остальные A\* с прежними unit/API PASS сохраняются как **PASS unit** / **PASS API**, без автоматического browser PASS.

---

## 7. Карта экран → API (актуально после Stage-1)

Care-orders и `report_ack` **доступны в live demo**.  
`/admin`, `/command` — по-прежнему отсутствуют.  
USB — stub.

Серверные состояния ответа врача:

| Состояние | Где фиксируется | Идемпотентность |
|---|---|---|
| `accepted` | создание отчёта | operation hash |
| `opened` | `POST .../opened` | серверное событие |
| `replied` | `POST .../messages` | message id |
| `device_received` | `report_ack` | один event на report |
| `patient_read` | `report_ack` + message_id | один event на report; повтор → `created:false` |

---

## 8. Блокеры демонстрации (после Stage-1)

**Сняты для CORE demo на одном браузере/API:**

1. ~~Live Docker без care_orders~~ — rebuild+migrate выполнены.  
2. ~~Ложный/отсутствующий server `patient_read`~~ — доставлен и проверен.  
3. ~~Потеря независимых операций при ошибке care refresh~~ — unit-закрыто.

**Остаются:**

1. **Dual-device / два физических устройства** — **не выполнено**.  
2. **ADMIN UI** — seed only.  
3. **DEVICE USB** — stub.  
4. **COMMAND UI** — нет.  
5. **PLAN §17** — нет draft/publish/occurrence/sensitive.  
6. Host `.env` Flight-Doc может не логинить из‑за truncation `#` — для E2E использовать credentials из контейнера (`backups/e2e.env`).

---

## 9. План дальше (после Stage-1)

1. Dual-device репетиция FLOW-05/06 на двух носителях.  
2. Browser-only mark-read UI после pull сообщения (сейчас ack частично через API в E2E).  
3. PLAN семантика §17 без препаратов.  
4. ADMIN / COMMAND / USB — отдельными этапами.

---

## 10. Сводка по уровням

| Уровень | Вердикт | Комментарий |
|---|---|---|
| **CORE** | **Готов к одноустройственному demo** | Browser E2E + API receipts без потери данных и с реальными `device_received`/`patient_read`. Dual-device не закрыт. |
| **ADMIN** | Не готово | Stage-1 не расширял |
| **PLAN** | Частично (live API есть) | Нет §17 draft/publish; PLAN-10/12 понижены с завышенных PASS |
| **DEVICE** | Не готово | USB stub |
| **COMMAND** | Не готово | A49 только pytest |

---

## 11. Артефакты доказательств Stage-1

| Артефакт | Назначение |
|---|---|
| `backups/demo_pg_20261115_005027.dump` | pg_dump до миграций |
| `backups/e2e_core_stage1_result.json` | 22/22 browser steps |
| `scripts/e2e_api_receipts.mjs` | live API receipts |
| `scripts/e2e_core_stage1.mjs` | browser CORE |
| `backend/tests/test_report_ack.py` | unit/API patient_read |
| `src/services/delivery.test.ts` | care-refresh isolation |

**Итог этапа:** воспроизводимый основной CORE-сценарий на `localhost:4173` + live API без потери локальных записей и без ложных статусов доставки на сервере.  
**Проверка на двух физических устройствах: не выполнена.**

---

*Конец отчёта Stage-1.*
