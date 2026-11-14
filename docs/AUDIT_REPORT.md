# AUDIT_REPORT — OrbitCare / Artemia

Дата аудита: **2026-11-15**.  
Источник требований: `docs/OrbitCare_Cursor_Functional_Audit.md` v1.0.  
Продуктовый код **не изменялся**.

Статусы: **PASS** (проверено поведением в этой сессии), **PARTIAL**, **FAIL**, **NOT_IMPLEMENTED**, **BLOCKED**, **OUT_OF_SCOPE**, **CODE_ONLY** (код найден, поведение в этой сессии не прогонялось).

---

## 1. Фактический стек и команды запуска

| Слой | Факт |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8, IndexedDB (Dexie), Zod, React Router |
| Backend | FastAPI (Python), JWT login, `POST /operations` |
| БД | PostgreSQL 16, Alembic, SQLAlchemy |
| Auth | Email/password → JWT; роль из `mission_memberships`, не из client claim |
| Локально | `artemia-journal` IndexedDB; outbox + receipts |
| Демо-сид | Mira / Alex / Flight-Doc из `.env` (пароли не в отчёте) |

Команды (фактически использованные / из compose):

- `docker compose up --build -d` — API + Postgres  
- `yarn dev` — http://localhost:5173  
- `yarn test` — unit  
- `cd backend; .\.venv\Scripts\python -m pytest -q` — API tests  
- `yarn build` — ранее в сессии разработки (не повторялся в этом аудите)

`AGENTS.md` в репозитории отсутствует. Корневой `README.md` — шаблон Vite, не описание продукта. Рабочий журнал: `docs/PROGRESS.md`.

---

## 2. Что удалось запустить; ограничения окружения

| Проверка | Результат |
|---|---|
| `GET http://localhost:8000/health` | `{"status":"ok"}` |
| Vite `http://localhost:5173` | HTTP 200 |
| `yarn test` | **65 passed** |
| `pytest -q` (весь backend) | **33 passed** |
| Live login Mira/Alex/Doc (из контейнера) | ok; роли astronaut/astronaut/doctor |
| Live `GET /ground/inbox` Doc | 200, items=0 |
| Live `GET /ground/inbox` Alex | **403** |
| Live `GET /preparation` Mira / Doc | 200 / **403** |
| Live OpenAPI | **нет** маршрутов care-orders / admin / command |
| Live БД `pg_tables` | **нет** `care_orders*` (есть `operational_statuses` без API) |
| Playwright / ручной E2E браузер по FLOW | **не запускался** |
| USB ESP32 | железо недоступно |
| Почтовые приглашения | нет провайдера; не трогались |

**Ограничение:** контейнер API, поднятый ранее, **не содержит** код/миграцию care orders. В исходниках и в pytest care orders есть; в **живом demo-окружении** PLAN API = 404. Это разрыв deploy, не отсутствие кода.

---

## 3. Карта экран → компонент → API → хранение → права

| Экран | Компонент | API / sync | Хранение | Права |
|---|---|---|---|---|
| `/login` | `LoginPage.tsx` | `POST /auth/login`, `GET /auth/me` | token в session | любой; роль с сервера |
| `/prepare` | `PreparePage.tsx` | `GET /preparation` | IndexedDB profile/mission | только astronaut |
| `/onboard/today` | `TodayPage.tsx` | delivery worker → `/operations`, `/pull`, `/care-orders`* | local checkins/measurements/reports/careOrders | владелец профиля |
| `/onboard/checkin/*` | `CheckinPage.tsx` / `CheckinViewPage.tsx` | `checkin_bundle` | drafts, revisions, outbox | владелец |
| `/onboard/measurements` | `MeasurementsPage.tsx` | `measurement` | localMeasurements | владелец; USB stub |
| `/onboard/history` | `HistoryPage.tsx` | — | local | владелец |
| `/onboard/orders` | `OrdersPage.tsx` | `care_order_response` + `/care-orders`* | localCareOrders | пациент |
| `/onboard/reports/*` | `ReportPages.tsx` | `report_bundle`, pull messages | localReports/messages | владелец |
| `/onboard/sync` | `ConnectionPage.tsx` | `/health`, `/operations`, `/pull` | outbox/receipts | владелец |
| `/onboard/profile` | `ProfilePage.tsx` | preferences/consent ops | local + outbox | владелец |
| `/evidence` | `EvidencePage.tsx` | — | catalog | открытый |
| `/ground/inbox` | `GroundPages.tsx` | `GET /ground/inbox` | memory slice | membership role=doctor |
| `/ground/reports/:id` | `GroundPages.tsx` | report + opened + messages | memory | назначенный врач |
| `/ground/crew/:id` | `GroundPages.tsx` | crew + **orders*** | memory | назначенный врач |
| `/admin`, `/command` | — | — | — | **нет UI/API** |

\* `/care-orders` и ground orders: в **коде + pytest**; в **живом контейнере этой сессии — отсутствуют**.

IndexedDB v1+v2: `db.ts` (`localCareOrders` в v2). Серверные таблицы stage1 + миграция `20261115_0002_care_orders` (применяется в pytest; **не применена** к demo DB).

---

## 4. Матрица FLOW / PLAN / A01–A50

### 4.1. FLOW-01…FLOW-15

| ID | Уровень | Ожидаемое | Фактическое | Статус | Доказательство | Влияние | Минимальное исправление |
|---|---|---|---|---|---|---|---|
| FLOW-01 | ADMIN | Создать миссию/пригласить через UI | Только seed `backend/app/seed.py`; нет `/admin` | NOT_IMPLEMENTED | OpenAPI live без `/admin`; `seed.py` | Нет орг. UI | Реализовать ADMIN или явно демо-seed only |
| FLOW-02 | CORE | Дневник без personal | Код формы + `personalDraft.test.ts`; E2E браузер не гонялся | PARTIAL / CODE_ONLY UI | `CheckinPage.tsx`, yarn personal tests | Риск регрессии UI | Playwright FLOW-02 |
| FLOW-03 | CORE | local_only sensitive | Сервер/клиент тесты A12 | PASS (API/unit) | `stage4.test.ts`, `test_stage4.py` | — | UI smoke |
| FLOW-04 | CORE | Разрешённая sensitive + deny чужим | Тесты согласия/доступа | PASS (API/unit) | `test_access.py`, `test_stage4.py` | — | — |
| FLOW-05 | CORE | Offline production build | Unit A03/A06 + delivery; полный dual-device не в этой сессии | PARTIAL | `acceptanceRemaining.test.ts`, `delivery.test.ts`; этап 7 в PROGRESS открыт | Демо на 2 устройствах не закрыт | Репетиция FLOW-05 |
| FLOW-06 | CORE | Ответ врача + этапы | opened/messages API + клиент mark read; полный offline doctor→board не E2E | PARTIAL | `test_stage4.py`, `ReportPages.tsx` markMessageRead | Нет отдельного patient_read receipt на сервере как в тексте аудита | Уточнить модель read vs локальный флаг |
| FLOW-07 | PLAN | План: draft→publish→ack→execute | Упрощённые care_orders без draft/publish/occurrence | PARTIAL (код) / BLOCKED (live) | `care_orders.py`, `test_care_orders.py`; live OpenAPI без routes | Демо PLAN на текущем Docker не работает | Rebuild+migrate; затем довести до §17 |
| FLOW-08 | PLAN | Offline execute после cancel/revise | revise/cancel + ack есть; offline conflict «выполнено по старой версии» не моделируется | PARTIAL | `care_orders.py` revise/cancel | Потеря семантики v1/v2 | Версии + occurrence |
| FLOW-09 | DEVICE | USB ESP32 | UI stub «позже» / «недоступно» | NOT_IMPLEMENTED | `MeasurementsPage.tsx:119-120` | Нет аппаратного демо | USB протокол или явный sim |
| FLOW-10 | CORE | Исправление + новый отчёт | Ревизии/invalidation в коде+тестах | PASS (API/unit) | A35 `test_stage4.py`, checkin revise UI | — | Browser smoke |
| FLOW-11 | CORE/ADMIN | Отзыв согласия; смена врача UI | Отзыв согласия тесты; смена врача только через БД/admin UI нет | PARTIAL | A33/A34 tests; no admin revoke UI | Нельзя сменить врача в UI | ADMIN назначения |
| FLOW-12 | COMMAND | Операционный статус | Таблица есть, UI/API нет; A49 deny medicine | NOT_IMPLEMENTED (+ A49 API PASS) | `OperationalStatus` model; `test_a49_roles.py` | Нет экрана командира | `/command` + publish op |
| FLOW-13 | CORE | Double submit / hash conflict | Тесты delivery/operations/access | PASS | `delivery.test.ts`, `test_operations.py`, A19/A20 | — | — |
| FLOW-14 | CORE | Истёкшая сессия / другой user | Unit delivery 401/чужой user | PASS (unit) | `delivery.test.ts` A22/A23 | — | Live token expiry smoke |
| FLOW-15 | ADMIN | completed миссии | У миссии нет lifecycle draft/active/completed/archived | NOT_IMPLEMENTED | `Mission` model: mode short/extended, **нет status** | Нельзя завершить миссию | Поле status + правила |

### 4.2. PLAN-01…PLAN-12

| ID | Уровень | Ожидаемое | Фактическое | Статус | Доказательство | Влияние | Минимальное исправление |
|---|---|---|---|---|---|---|---|
| PLAN-01 | PLAN | Врач без назначения не создаёт | 403 без assignment (pytest) | PASS | `test_care_orders.py`, `test_a49_roles.py` | Live API без routes | Deploy миграции |
| PLAN-02 | PLAN | Нет типа «Препарат» | Kinds без medication; prototype_limit | PASS | `CARE_KINDS` в `care_orders.py`; assert no medication | — | Сохранить запрет на сервере |
| PLAN-03 | PLAN | Черновик не виден пациенту | Статус сразу `active` при create; нет draft | FAIL vs §17 | `create_order` → status active | Пациент видит сразу | Добавить draft/publish |
| PLAN-04 | PLAN | Публикация ≠ доставка ≠ ack | Нет publish; ack_required только после revise/cancel | PARTIAL | `ack_required` fields | Смешение состояний | Три независимых оси §17.2 |
| PLAN-05 | PLAN | Идемпотентность response | operation_id + hash; double submit local | PASS | `test_care_orders.py`, `careOrders.test.ts` | — | — |
| PLAN-06 | PLAN | Offline execute → врач | Код outbox response; live board refresh нет в Docker | CODE_ONLY / BLOCKED live | `OrdersPage.tsx`, delivery refreshCareOrders | — | Deploy + E2E |
| PLAN-07 | PLAN | Изменение = новая версия | `revision_no++` in-place, не отдельная сущность occurrence | PARTIAL | `revise_order` | История слабее §17 | Версии/экземпляры |
| PLAN-08 | PLAN | Cancel не убивает поздний offline факт | Response при cancelled → validation/forbidden; спец. метки нет | PARTIAL | `apply_care_order_response` | Риск потери/конфликта | Политика stale execute |
| PLAN-09 | PLAN | Sensitive план | Нет visibility sensitive/general у care_orders | NOT_IMPLEMENTED | schema care_orders | Утечка/невозможность sensitive задач | Поле visibility + consent |
| PLAN-10 | PLAN | Overdue ≠ done/тревога | due_at есть; UI «срок прошёл»; авто-done нет | PASS (код) | `OrdersPage` careStaleDue | — | Не добавлять авто-done |
| PLAN-11 | PLAN | Пациент не правит инструкцию | Response только decision/note | PASS | payload schema response | — | — |
| PLAN-12 | PLAN | Чужой mission/measurement | order owned by subject; чужой order forbidden | PASS | `order_not_owned` | — | Связь measurement_id (ещё нет) |

### 4.3. A01–A50 (исходный чек-лист)

Легенда доказательства: **R** = перепроверено этой сессией (yarn/pytest/live); **P** = заявлено в `docs/PROGRESS.md` с тестом, в этой сессии отдельно не E2E.

| ID | Уровень | Ожидаемое | Фактическое | Статус | Доказательство | Влияние | Минимальное исправление |
|---|---|---|---|---|---|---|---|
| A01 | CORE | Разные маршруты | astronaut→prepare/today, doctor→inbox | PASS R | `acceptanceRoutes.test.ts`, `test_acceptance_a01_a02.py`, live roles | — | — |
| A02 | CORE | Prepare без сети блокирует | unit + API 401 | PASS R | acceptance tests | — | — |
| A03 | CORE | Offline today после prepare | IndexedDB reopen test | PASS R | `acceptanceRemaining.test.ts` | — | — |
| A04 | CORE | Offline fill + reload | draft persistence tests; browser FLOW не гонялся | PARTIAL P | checkin draft tests / PROGRESS | — | Playwright A04 |
| A05 | CORE | Tab close после commit | journal persist tests | PARTIAL P | journal.test.ts | — | Browser A05 |
| A06 | CORE | Double save | simultaneous commit | PASS R | acceptanceRemaining A06 | — | — |
| A07 | CORE | 0 vs skip | domain payloads | PASS R | `payloads.test.ts`, checkinDraft | — | — |
| A08 | CORE | Back keeps draft | test | PASS R | A08 acceptanceRemaining | — | — |
| A09 | CORE | Other without label | validation | PASS R | checkinDraft.test | — | — |
| A10 | CORE | Future >5 min | validation | PASS R | checkinDraft.test | — | — |
| A11 | CORE | Personal off | personalDraft | PASS R | personalDraft.test | — | UI smoke |
| A12 | CORE | local_only no network | stage4 | PASS R | stage4 client+server | — | — |
| A13 | CORE | Чужой astronaut 403 | access | PASS R | test_access + live alex inbox 403 | — | — |
| A14 | CORE | Врач без назначения | stranger 403 | PASS R | test_access, test_care_orders | — | — |
| A15 | CORE | Без consent → personal 403 | stage4/access | PASS R | tests | — | — |
| A16 | CORE | Role claim ignored | forged token | PASS R | test_access | — | — |
| A17 | CORE | Нет прямого INSERT API | openapi allowlist | PASS R | test_access posts list | — | — |
| A18 | CORE | Чужой measurement_id | operations | PASS R | test_access | — | — |
| A19 | CORE | Same op/hash → same receipt | operations/delivery | PASS R | tests | — | — |
| A20 | CORE | Same op other hash → conflict | operations | PASS R | tests | — | — |
| A21 | CORE | Lost response no dup | delivery | PASS R | delivery.test | — | — |
| A22 | CORE | 401 blocked_auth | delivery | PASS R | delivery.test | — | — |
| A23 | CORE | Other user queue | delivery | PASS R | delivery.test | — | — |
| A24 | CORE | 403/422/429/5xx | delivery | PASS R | delivery.test | — | — |
| A25 | CORE | Two tabs one send | delivery lock | PASS R | delivery.test overlapping | — | — |
| A26 | CORE | parent_revision conflict | operations | PASS P/R | test_operations / PROGRESS | Уточнить покрытие | Явный тест A26 label |
| A27 | CORE | Independent after error | delivery | PASS R | delivery.test | — | — |
| A28 | CORE | Pull cursor | pull | PASS R | test_pull + delivery pull | — | — |
| A29 | CORE | No realtime needed | pull-only design | PASS (design+pull) | нет WS в коде; pull есть | — | — |
| A30 | CORE | Preview=snapshot | reportSnapshot | PASS R | reportSnapshot + stage4 | — | — |
| A31 | CORE | accepted ≠ opened | stage4 | PASS R | tests | — | — |
| A32 | CORE | opened ≠ replied | stage4 | PASS R | tests | — | — |
| A33 | CORE | Revoke online | stage4 | PASS R | tests | — | — |
| A34 | CORE | Revoke offline pending | stage4 | PASS R | tests | — | — |
| A35 | CORE | New revision, old report | stage4 | PASS R | tests | — | — |
| A36 | CORE | Insufficient history | presentation | PASS R | presentation.test | — | — |
| A37 | CORE | Invalid/sim excluded | trends | PASS R | presentation.test | — | — |
| A38 | CORE | Closed DB no false save | journal | PASS R | journal.test | — | — |
| A39 | CORE | Unicode hash | canonical | PASS R | canonicalJson.test + backend | — | — |
| A40 | CORE | 390px / keyboard | PROGRESS browser; не перепроверено | CODE_ONLY / P | PROGRESS этап 5 | — | Повторный UI pass |
| A41 | CORE | HTML as text | presentation comment | PASS R | presentation.test | — | — |
| A42 | CORE | No secrets in build | client sources test | PASS R | presentation.test service_role | Логи runtime не снимались | Log sample |
| A43 | CORE | Clear blocked if pending | clearOwner | PASS R | acceptanceRemaining | — | — |
| A44–A48 | DEVICE | USB states | Stub only | NOT_IMPLEMENTED | MeasurementsPage USB | — | USB stack |
| A49 | COMMAND/ADMIN | Medicine deny | pytest commander/admin 403 | PASS R | `test_a49_roles.py` | Live seed без commander/admin | Seed demo roles optional |
| A50 | NEXT | PWA mid-form | Нет SW | NOT_IMPLEMENTED | grep serviceWorker пусто | — | PWA later |

---

## 5. Матрица условных полей (§21) — выборочно

| Условие | Ожидаемое | Фактическое | Статус | Доказательство | Минимальное исправление |
|---|---|---|---|---|---|
| Personal выключен | Нет шага | Поддерживается | PASS R | personalDraft.test | — |
| Пропуск personal | Не «нет проблем» | Явно | PASS R | personalDraft.test | — |
| Symptoms Other без имени | Ошибка | Да | PASS R | checkinDraft | — |
| local_only | Не в сети | Да | PASS R | stage4 | — |
| Нет врача | Не отправлять отчёт в никуда | Prepare показывает assignment; отчёт требует recipient | CODE_ONLY | prepare/report code | E2E без assignment |
| Врач не свой | 403 | Да | PASS R | access/care tests + live alex | — |
| USB отсутствует | Ручной ввод | Ручной есть; USB текст | PARTIAL | MeasurementsPage | Не блокировать manual (уже) |
| Задание draft | Скрыто от пациента | Draft нет | FAIL | create_order active | draft/publish |
| Тип препарат | Запрет | Отсутствует в enum | PASS | enums/CARE_KINDS | — |
| Клиент чужой ID | Отказ | Да | PASS R | operations/access | — |

Полный перебор всех строк §21 в браузере **не выполнялся**.

---

## 6. Серверные проверки ролей / назначения / согласия / обхода

| Проверка | Результат | Статус | Доказательство |
|---|---|---|---|
| Роль из membership, не из JWT claim | forged role не открывает | PASS R | `test_access.py` role claim |
| Назначенный врач читает general | 200 | PASS R | test_access |
| Чужой astronaut / unassigned doctor | 403 | PASS R | test_access; live alex inbox 403 |
| Personal без consent | 403 | PASS R | test_access/stage4 |
| Нет `/auth/register` | 404 | PASS R | live probe register |
| Нет browser DB access | только API | PASS | архитектура FastAPI |
| Commander/admin medicine | 403 на checkin/ground/orders | PASS R | `test_a49_roles.py` (test seed) |
| Commander/admin в demo seed | **нет** | PARTIAL env | `seed.py` только 3 профиля |
| Care orders на live demo | **404 / нет таблиц** | BLOCKED deploy | OpenAPI live; `\dt` |
| Admin org API | нет | NOT_IMPLEMENTED | OpenAPI |
| Command status API | нет (таблица пустая оболочка) | NOT_IMPLEMENTED | models only |
| RLS Postgres | не используется; изоляция в API | допустимое отличие | audit §18 |

---

## 7. Расхождения со старым ТЗ / допустимые отличия (не дефекты)

| Тема | Оценка |
|---|---|
| FastAPI вместо Supabase/RPC | Допустимо (§0) |
| Care orders вместо полного «Плана наблюдения» §17 | **Дополнение PLAN**: частичная реализация; не регрессия CORE |
| Нет препаратов | Соответствует решению пользователя |
| Симулятор: карточка есть, записи simulated из UI не создаются | Расхождение с «рабочий sim» |
| Forgot password: локальный текст, без API | Упрощение P0 |
| Mission без status lifecycle | Расхождение с новым уточнением audit §3 |
| Crew tabs: overview+orders вместо History/Reports/Personal | Упрощение UI |
| `patient_read` как отдельный server receipt | Локальный mark read сообщений; уточнить модель |
| README шаблонный | Документационный gap |

---

## 8. Блокеры демонстрации

1. **Живой Docker без care_orders** — UI заказов на борту/враче не сможет получить/создать задачи, пока не `compose up --build` + миграция `20261115_0002`.  
2. **ADMIN UI отсутствует** — миссия только seed; FLOW-01 как UI не демонстрируется.  
3. **DEVICE USB не реализован** — аппаратное обещание нельзя делать.  
4. **COMMAND UI отсутствует** — командир только как роль в тестах A49.  
5. **Этап 7 / два устройства** — полный offline→doctor E2E в PROGRESS ещё «в работе».  
6. **Нет потери данных/утечки** по перепроверенным API-тестам прав; фиктивных квитанций в unit delivery не видно. Live PLAN сейчас **не готов**.

Не блокеры CORE: отсутствие admin UI (если демо идёт от seed).

---

## 9. Минимальный план исправлений (порядок зависимости)

1. **Deploy:** пересобрать API-контейнер, применить Alembic care_orders; smoke live create/list/response.  
2. **Права/данные:** оставить assignment-gated care orders; опционально seed commander/admin в demo для A49 live.  
3. **PLAN семантика:** draft→publish; разделить delivery/ack/execution; occurrence_id; unable; не добавлять препарат.  
4. **CORE E2E:** Playwright FLOW-02/05/06 на production preview.  
5. **ADMIN:** миссии/приглашения/назначения UI **после** стабильного CORE demo.  
6. **COMMAND:** publish operational status + `/command`.  
7. **DEVICE:** USB или честный «только ручной/запись».  
8. **Docs:** заменить шаблонный README; зафиксировать «PLAN упрощён vs §17».

---

## 10. Сводка по уровням

| Уровень | Вердикт | Комментарий |
|---|---|---|
| **CORE** | **Частично → близко к готово** | Вертикаль astronaut→IndexedDB→operations→assigned doctor→reply подтверждена unit/API и live login/rights. Полный browser/dual-device FLOW этой сессией не закрыт. |
| **ADMIN** | **Не готово** | Seed only; нет UI/API создания миссий, приглашений, смены врача, lifecycle. |
| **PLAN** | **Частично (код) / не готово (live demo)** | Care tasks без лекарств есть в коде+pytest; нет draft/publish/occurrence/sensitive; **live контейнер без routes/tables**. |
| **DEVICE** | **Не готово** | USB stub; sim карточка без полноценного потока сбора. |
| **COMMAND** | **Не готово** (API deny medicine — да) | Нет `/command` и публикации статусов; A49 API PASS в pytest. |

---

## 11. Дополнительные точечные находки UI/API

| ID | Уровень | Ожидаемое | Фактическое | Статус | Доказательство | Влияние | Минимальное исправление |
|---|---|---|---|---|---|---|---|
| UI-LOGIN | CORE | Forgot password online | Текст «организатор»; нет endpoint | PARTIAL | `LoginPage.tsx` forgotBody | Ок для demo | Не обещать email reset |
| UI-PREPARE | CORE | 3 шага, 7 checks | Реализовано | CODE_ONLY | PreparePage | — | Browser walkthrough |
| UI-TODAY | CORE | Карточки + care card | Care card добавлена | CODE_ONLY | TodayPage | Live pull care 404 | Deploy API |
| UI-MEAS | DEVICE | USB/sim рабочие | Manual ok; USB later; sim banner | PARTIAL | MeasurementsPage | — | Не заявлять USB |
| UI-GROUND-CREW | CORE/PLAN | Вкладки Обзор/История/Отчёты/Personal + план | overview + Задачи | PARTIAL | CrewPage tabs | Меньше врача UX | Добавить вкладки позже |
| UI-ADMIN | ADMIN | /admin | Нет маршрута | NOT_IMPLEMENTED | App.tsx routes | — | P1 |
| UI-COMMAND | COMMAND | /command | Нет | NOT_IMPLEMENTED | App.tsx | — | P1 |
| DATA-MISSION | ADMIN | draft→archived | Нет status | NOT_IMPLEMENTED | models.Mission | — | Миграция status |
| DATA-OPS-STATUS | COMMAND | publish/revoke | Таблица без API | NOT_IMPLEMENTED | OperationalStatus | — | CRUD + ACL |
| SEC-A49-SEED | COMMAND | Demo users | Только в pytest support | PARTIAL | seed.py vs support.py | Live A49 нельзя | Опциональный seed |

---

*Конец отчёта. Продуктовый код не менялся. Временный probe-скрипт удалён с хоста.*
