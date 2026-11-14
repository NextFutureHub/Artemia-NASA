export type Locale = 'ru' | 'en'

type Pair = { ru: string; en: string }

export const copy = {
  appName: { ru: 'Artemia', en: 'Artemia' },
  demo: { ru: 'ДЕМО · синтетические профили', en: 'DEMO · synthetic profiles' },
  loading: { ru: 'Открываем локальный журнал', en: 'Opening the local journal' },
  unavailable: { ru: 'Запись недоступна или у вас нет прав', en: 'The record is unavailable or you do not have access' },
  cancel: { ru: 'Отмена', en: 'Cancel' },
  close: { ru: 'Закрыть', en: 'Close' },
  back: { ru: 'Назад', en: 'Back' },
  continue: { ru: 'Продолжить', en: 'Continue' },
  retry: { ru: 'Повторить', en: 'Retry' },
  home: { ru: 'На главную', en: 'Home' },
  logout: { ru: 'Выйти', en: 'Sign out' },
  settings: { ru: 'Настройки', en: 'Settings' },
  sources: { ru: 'Источники', en: 'Sources' },
  notFound: { ru: 'Такой страницы нет', en: 'This page does not exist' },
  storageFailed: {
    ru: 'На этом устройстве невозможно надёжно сохранить журнал',
    en: 'This device cannot reliably store the journal',
  },
  saveDeviceFailed: {
    ru: 'Не удалось сохранить на устройстве. Не закрывайте форму.',
    en: 'The device could not store this. Do not close the form.',
  },
  loginLead: {
    ru: 'Наблюдение за здоровьем экипажа при ограниченной связи',
    en: 'Crew health notes when the link to Earth is limited',
  },
  loginPoint1: { ru: 'Запись сначала сохраняется на устройстве.', en: 'A note is stored on the device first.' },
  loginPoint2: { ru: 'Врач видит только назначенные ему сведения.', en: 'A physician sees only assigned information.' },
  loginPoint3: { ru: 'Приложение не ставит диагноз.', en: 'The application does not make a diagnosis.' },
  email: { ru: 'Электронная почта', en: 'Email' },
  password: { ru: 'Пароль', en: 'Password' },
  showPassword: { ru: 'Показать пароль', en: 'Show password' },
  hidePassword: { ru: 'Скрыть пароль', en: 'Hide password' },
  signIn: { ru: 'Войти', en: 'Sign in' },
  forgot: { ru: 'Забыли пароль?', en: 'Forgot password?' },
  forgotBody: {
    ru: 'В демонстрации пароль выдаёт организатор. Приложение не сообщает, существует ли адрес.',
    en: 'In the demo the organizer issues the password. The application does not reveal whether an address exists.',
  },
  language: { ru: 'Язык', en: 'Language' },
  openPrepared: { ru: 'Открыть подготовленный журнал', en: 'Open the prepared journal' },
  signInFailed: {
    ru: 'Не удалось войти. Проверьте данные или соединение.',
    en: 'Sign-in failed. Check the details or the connection.',
  },
  signInNetwork: {
    ru: 'Нет связи с сервером. Подготовленный журнал можно открыть без входа.',
    en: 'The server is unreachable. A prepared journal can be opened without signing in.',
  },
  today: { ru: 'Сегодня', en: 'Today' },
  todaySubtitle: { ru: 'Ваш журнал на этот день', en: 'Your journal for this day' },
  wellbeing: { ru: 'Самочувствие', en: 'How you feel' },
  notFilled: { ru: 'Ещё не заполнено', en: 'Not filled in yet' },
  draft: { ru: 'Черновик', en: 'Draft' },
  completed: { ru: 'Завершено', en: 'Completed' },
  fill: { ru: 'Заполнить', en: 'Fill in' },
  resume: { ru: 'Продолжить', en: 'Continue' },
  openRecord: { ru: 'Открыть запись', en: 'Open record' },
  addRecord: { ru: 'Добавить запись', en: 'Add a record' },
  lastMeasurement: { ru: 'Последнее измерение', en: 'Latest measurement' },
  noMeasurement: { ru: 'Измерений пока нет', en: 'No measurements yet' },
  measure: { ru: 'Измерить', en: 'Measure' },
  ago: { ru: 'Последнее измерение {time} назад', en: 'Latest measurement {time} ago' },
  attention: { ru: 'На что обратить внимание', en: 'What to look at' },
  noHints: { ru: 'Новых подсказок нет', en: 'No new notes' },
  why: { ru: 'Почему?', en: 'Why?' },
  hideHome: { ru: 'Скрыть с главной', en: 'Hide from home' },
  doctorCard: { ru: 'Связь с врачом', en: 'Link with the physician' },
  noReply: { ru: 'Ответов пока нет', en: 'No replies yet' },
  pendingOps: { ru: '{count} операций ожидают связи', en: '{count} operations are waiting for a link' },
  contact: { ru: 'Связаться с медиком', en: 'Contact medical support' },
  prepareMessage: { ru: 'Подготовить сообщение', en: 'Prepare a message' },
  showProcedure: { ru: 'Показать бортовой порядок обращения', en: 'Show the onboard contact procedure' },
  procedureMissing: {
    ru: 'Порядок обращения для этой миссии не настроен',
    en: 'No contact procedure is configured for this mission',
  },
  noEmergencyPromise: {
    ru: 'Без связи сообщение не обещает экстренную доставку.',
    en: 'Without a link, a message is not an emergency delivery.',
  },
  feed: { ru: 'Последние события', en: 'Recent events' },
  noEvents: { ru: 'Событий пока нет', en: 'No events yet' },
  prototypeRule: { ru: 'Правило прототипа', en: 'Prototype rule' },
  noCurrentTitle: { ru: 'Запись сохранена без измерений', en: 'Record saved without measurements' },
  noCurrentBody: {
    ru: 'К записи не прикреплено измерение. Это не тревога.',
    en: 'No measurement is attached. This is not an alert.',
  },
  reviewTitle: { ru: 'Вы запросили просмотр записи', en: 'You asked for this record to be reviewed' },
  reviewBody: {
    ru: 'Запрос будет доставлен, когда появится связь. Это не диагноз.',
    en: 'The request will be delivered when a link returns. This is not a diagnosis.',
  },
  addMeasurement: { ru: 'Добавить измерение', en: 'Add a measurement' },
  prepareReport: { ru: 'Подготовить отчёт', en: 'Prepare a report' },
  reportLater: {
    ru: 'Отчёты собираются на следующем этапе. Сейчас кнопка ничего не отправляет.',
    en: 'Reports are built in the next stage. This button sends nothing now.',
  },
  missionDay: { ru: 'День миссии {day}', en: 'Mission day {day}' },
  beforeStart: { ru: 'До старта {days} дней', en: 'Launch in {days} days' },
  serverUp: { ru: 'Сервер доступен', en: 'Server reachable' },
  serverDown: { ru: 'Нет связи с сервером', en: 'No link to the server' },
  authRequired: { ru: 'Нужен повторный вход', en: 'Sign in again' },
  checking: { ru: 'Проверяем связь', en: 'Checking the link' },
  queueCount: { ru: 'В очереди: {count}', en: 'Queued: {count}' },
  menu: { ru: 'Меню', en: 'Menu' },
  measurements: { ru: 'Измерения', en: 'Measurements' },
  history: { ru: 'История', en: 'History' },
  reports: { ru: 'Отчёты', en: 'Reports' },
  profile: { ru: 'Профиль', en: 'Profile' },
  sync: { ru: 'Связь и доставка', en: 'Link and delivery' },
  prepareTitle: { ru: 'Подготовка устройства', en: 'Prepare this device' },
  stepProfile: { ru: 'Проверьте профиль', en: 'Check the profile' },
  stepJournal: { ru: 'Настройте журнал', en: 'Set up the journal' },
  stepDevice: { ru: 'Подготовьте устройство', en: 'Prepare the device' },
  myData: { ru: 'Это мои данные', en: 'These are my details' },
  reportError: { ru: 'Сообщить об ошибке', en: 'Report an error' },
  reportErrorBody: {
    ru: 'Сообщите организатору демонстрации. Приложение не отправляет письмо.',
    en: 'Tell the demo organizer. The application does not send an email.',
  },
  timezone: { ru: 'Часовой пояс отображения', en: 'Display time zone' },
  reminder: { ru: 'Напоминание', en: 'Reminder' },
  reminderHint: {
    ru: 'Работает только пока приложение открыто. Фоновые уведомления не обещаются.',
    en: 'Works only while the application is open. Background alerts are not promised.',
  },
  personalToggle: { ru: 'Показывать вопросы о менструальном и репродуктивном здоровье', en: 'Show menstrual and reproductive health questions' },
  personalHint: {
    ru: 'Выключение скрывает будущие вопросы и не удаляет историю. В этой сборке шаг ещё не заполняется и ничего из него не передаётся.',
    en: 'Turning this off hides future questions and does not delete history. This build does not collect that step and sends none of it.',
  },
  sensitiveMode: { ru: 'Режим чувствительных данных', en: 'Sensitive data mode' },
  deviceOnly: { ru: 'Только на этом устройстве', en: 'This device only' },
  assignedDoctor: { ru: 'Передавать назначенному врачу', en: 'Share with the assigned physician' },
  exchange: { ru: 'Передавать завершённые общие записи назначенному врачу', en: 'Share completed general records with the assigned physician' },
  exchangeHint: {
    ru: 'Без этой отметки запись остаётся на устройстве. Для основного демонстрационного сценария передача нужна, но выбор остаётся за вами.',
    en: 'Without this choice the record stays on the device. The main demo needs sharing, and the choice remains yours.',
  },
  loadChecks: { ru: 'Загрузить и проверить', en: 'Load and check' },
  startWork: { ru: 'Начать работу', en: 'Start' },
  otherOwner: {
    ru: 'Это устройство уже хранит журнал другого участника. Сначала синхронизируйте очередь и очистите профиль.',
    en: 'This device already holds another participant’s journal. Synchronize the queue and clear the profile first.',
  },
  firstPrepareOffline: {
    ru: 'Сервер недоступен. Первую подготовку нельзя завершить без него.',
    en: 'The server is unreachable. The first preparation cannot finish without it.',
  },
  checkInterface: { ru: 'Интерфейс доступен', en: 'Interface is available' },
  checkStorage: { ru: 'Локальное хранилище доступно', en: 'Local storage is available' },
  checkProfile: { ru: 'Профиль загружен', en: 'Profile loaded' },
  checkReferences: { ru: 'Справочники загружены', en: 'References loaded' },
  checkHistory: { ru: 'История загружена', en: 'History loaded' },
  checkRules: { ru: 'Правила загружены', en: 'Rules loaded' },
  checkAssignment: { ru: 'Назначение врача проверено', en: 'Physician assignment checked' },
  assignmentMissing: {
    ru: 'Назначение не найдено. Журнал можно вести, отправка отчёта будет недоступна.',
    en: 'No assignment was found. The journal can be kept, and sending a report will be unavailable.',
  },
  persisted: { ru: 'Браузер разрешил более устойчивое хранение.', en: 'The browser allowed more persistent storage.' },
  persistDenied: {
    ru: 'Устойчивое хранение не получено. Журнал может быть очищен браузером.',
    en: 'Persistent storage was not granted. The browser may clear the journal.',
  },
  lowStorage: { ru: 'Свободного места мало. Очередь не удаляется автоматически.', en: 'Free space is low. The queue is not deleted automatically.' },
  callsign: { ru: 'Позывной', en: 'Call sign' },
  name: { ru: 'Имя', en: 'Name' },
  mission: { ru: 'Миссия', en: 'Mission' },
  physician: { ru: 'Назначенный врач', en: 'Assigned physician' },
  noPhysician: { ru: 'Назначение не задано', en: 'No assignment' },
  period: { ru: 'Период миссии', en: 'Mission period' },
  generalStep: { ru: 'Общее', en: 'General' },
  symptomsStep: { ru: 'Симптомы', en: 'Symptoms' },
  measurementsStep: { ru: 'Измерения', en: 'Measurements' },
  reviewStep: { ru: 'Проверка', en: 'Review' },
  localHint: { ru: 'Черновик хранится на устройстве', en: 'The draft stays on this device' },
  draftSaved: { ru: 'Черновик сохранён на устройстве · {time}', en: 'Draft saved on this device · {time}' },
  saveDraftExit: { ru: 'Сохранить черновик и выйти', en: 'Save draft and leave' },
  recordedAt: { ru: 'Время записи', en: 'Record time' },
  filledLater: { ru: 'Заполнено позже', en: 'Filled in later' },
  recordType: { ru: 'Тип записи', en: 'Record type' },
  daily: { ru: 'Ежедневная', en: 'Daily' },
  change: { ru: 'Изменение самочувствия', en: 'Change in how you feel' },
  overall: { ru: 'Общее самочувствие', en: 'Overall feeling' },
  sleep: { ru: 'Сон за последние 24 часа, часы', en: 'Sleep in the last 24 hours, hours' },
  sleepUnknown: { ru: 'Не знаю', en: "I don't know" },
  sleepQuality: { ru: 'Качество сна', en: 'Sleep quality' },
  skipRate: { ru: 'Не оценивать', en: 'Do not rate' },
  fatigue: { ru: 'Усталость сейчас', en: 'Fatigue now' },
  stress: { ru: 'Стресс сейчас', en: 'Stress now' },
  scaleNone: { ru: 'Нет', en: 'None' },
  scaleMax: { ru: 'Максимальная', en: 'Maximum' },
  emotional: { ru: 'Эмоциональное состояние', en: 'Emotional state' },
  context: { ru: 'Контекст', en: 'Context' },
  comment: { ru: 'Комментарий', en: 'Comment' },
  notATest: {
    ru: 'Это шкала самонаблюдения, не валидированный психологический тест.',
    en: 'This is a self-observation scale, not a validated psychological test.',
  },
  symptomQuestion: { ru: 'Есть ли симптомы, которые вы хотите отметить?', en: 'Are there symptoms you want to note?' },
  no: { ru: 'Нет', en: 'No' },
  yes: { ru: 'Да', en: 'Yes' },
  decline: { ru: 'Не хочу отвечать', en: 'I do not want to answer' },
  deleteSymptoms: {
    ru: 'Удалить ранее добавленные симптомы из этой записи?',
    en: 'Remove the symptoms already added to this record?',
  },
  reviewAsk: { ru: 'Хотите, чтобы врач обратил внимание на эту запись?', en: 'Do you want the physician to look at this record?' },
  reviewHint: {
    ru: 'Без связи запрос будет доставлен позже. При необходимости немедленной помощи используйте бортовой порядок обращения.',
    en: 'Without a link the request is delivered later. If you need immediate help, use the onboard contact procedure.',
  },
  severity: { ru: 'Выраженность', en: 'Intensity' },
  cannotRate: { ru: 'Не могу оценить', en: 'I cannot rate it' },
  onset: { ru: 'Когда началось', en: 'When it started' },
  persistence: { ru: 'Характер', en: 'Pattern' },
  impact: { ru: 'Мешает обычным действиям', en: 'Effect on usual activities' },
  removeSymptom: { ru: 'Удалить симптом', en: 'Remove symptom' },
  undo: { ru: 'Отменить удаление', en: 'Undo removal' },
  otherLabel: { ru: 'Название', en: 'Name' },
  measurementsOptional: {
    ru: 'Измерения необязательны. Запись самочувствия можно сохранить отдельно.',
    en: 'Measurements are optional. The feeling record can be saved on its own.',
  },
  continueWithout: { ru: 'Продолжить без измерений', en: 'Continue without measurements' },
  manualEntry: { ru: 'Ввести вручную', en: 'Enter manually' },
  newMeasurement: { ru: 'Новое измерение', en: 'New measurement' },
  attach: { ru: 'Прикрепить', en: 'Attach' },
  edit: { ru: 'Изменить', en: 'Edit' },
  generalDelivery: { ru: 'Общая часть', en: 'General part' },
  personalDelivery: { ru: 'Персональный раздел', en: 'Personal section' },
  personalOff: { ru: 'Выключен', en: 'Off' },
  personalLater: {
    ru: 'В этой сборке не заполняется и не передаётся',
    en: 'Not collected in this build and not sent',
  },
  linkState: { ru: 'Связь', en: 'Link' },
  linkUp: { ru: 'Доступна', en: 'Available' },
  linkDown: { ru: 'Отсутствует', en: 'Unavailable' },
  saveRecord: { ru: 'Сохранить запись', en: 'Save record' },
  savedOnDevice: { ru: 'Запись сохранена на устройстве', en: 'Record saved on this device' },
  waitingSend: { ru: 'Ожидает передачи', en: 'Waiting to be sent' },
  storedLocally: { ru: 'Хранится только на этом устройстве', en: 'Stored only on this device' },
  notServerReceipt: {
    ru: 'Сервер ещё не подтверждал получение.',
    en: 'The server has not confirmed receipt.',
  },
  receivedByServer: { ru: 'Сервер подтвердил получение', en: 'The server confirmed receipt' },
  backToday: { ru: 'На сегодня', en: 'Back to today' },
  leaveTitle: { ru: 'Есть несохранённый ввод', en: 'There is unsaved input' },
  leaveBody: { ru: 'Черновик можно сохранить на устройстве перед уходом.', en: 'The draft can be saved on the device before you leave.' },
  leave: { ru: 'Уйти', en: 'Leave' },
  stay: { ru: 'Остаться', en: 'Stay' },
  draftChoice: { ru: 'Уже есть черновик', en: 'A draft already exists' },
  continueDraft: { ru: 'Продолжить черновик', en: 'Continue the draft' },
  deleteDraft: { ru: 'Удалить черновик', en: 'Delete the draft' },
  reason: { ru: 'Причина исправления', en: 'Reason for the correction' },
  correct: { ru: 'Дополнить / исправить', en: 'Add to / correct' },
  versions: { ru: 'Версии', en: 'Versions' },
  manual: { ru: 'Вручную', en: 'Manual' },
  usbMissing: {
    ru: 'USB-подключение недоступно в этом браузере. Доступен ручной ввод.',
    en: 'USB is unavailable in this browser. Manual entry remains available.',
  },
  usbLater: {
    ru: 'Подключение датчика в этой сборке не включено. Доступен ручной ввод.',
    en: 'The sensor connection is not included in this build. Manual entry remains available.',
  },
  simulation: { ru: 'СИМУЛЯЦИЯ', en: 'SIMULATION' },
  simulationBody: {
    ru: 'Симулятор не создаёт измерение и не подменяет датчик.',
    en: 'The simulator does not create a measurement and does not stand in for a sensor.',
  },
  metric: { ru: 'Показатель', en: 'Measure' },
  value: { ru: 'Значение', en: 'Value' },
  instrument: { ru: 'Прибор или способ', en: 'Instrument or method' },
  unspecified: { ru: 'Не указан', en: 'Not specified' },
  note: { ru: 'Примечание', en: 'Note' },
  saveMeasurement: { ru: 'Сохранить измерение', en: 'Save measurement' },
  rangeError: {
    ru: 'Значение вне поддерживаемого диапазона ввода. Проверьте единицы; исходное наблюдение можно описать в комментарии.',
    en: 'The value is outside the supported entry range. Check the units; the original observation can be described in a comment.',
  },
  unknownQuality: { ru: 'Качество неизвестно. Это не подтверждение датчиком.', en: 'Quality is unknown. This is not sensor confirmation.' },
  savedMeasurement: { ru: 'Измерение сохранено на устройстве', en: 'Measurement saved on this device' },
  heartRate: { ru: 'Пульс', en: 'Heart rate' },
  temperature: { ru: 'Температура тела', en: 'Body temperature' },
  spo2: { ru: 'SpO₂', en: 'SpO₂' },
  rest: { ru: 'В покое', en: 'At rest' },
  afterExertion: { ru: 'После нагрузки', en: 'After exertion' },
  other: { ru: 'Другое', en: 'Other' },
  qualityUnknown: { ru: 'Неизвестно', en: 'Unknown' },
  sourceManual: { ru: 'Ручной ввод', en: 'Manual entry' },
  sourceDevice: { ru: 'Устройство', en: 'Device' },
  sourceSimulated: { ru: 'Симуляция', en: 'Simulation' },
  sourceServer: { ru: 'Загружено при подготовке', en: 'Loaded during preparation' },
  apply: { ru: 'Применить', en: 'Apply' },
  from: { ru: 'С', en: 'From' },
  to: { ru: 'По', en: 'To' },
  days7: { ru: '7 дней', en: '7 days' },
  days30: { ru: '30 дней', en: '30 days' },
  allTime: { ru: 'Весь период', en: 'Whole period' },
  pickDates: { ru: 'Выбрать даты', en: 'Choose dates' },
  allTypes: { ru: 'Все', en: 'All' },
  loadMore: { ru: 'Загрузить ещё', en: 'Load more' },
  historyEmpty: { ru: 'За выбранный период записей нет', en: 'No records in the selected period' },
  chartsLater: {
    ru: 'Графики появятся после того, как журнал и доставка будут устойчивыми.',
    en: 'Charts come after the journal and delivery are reliable.',
  },
  basic: { ru: 'Основное', en: 'Basics' },
  journalSettings: { ru: 'Настройки журнала', en: 'Journal settings' },
  privacy: { ru: 'Приватность', en: 'Privacy' },
  deviceSection: { ru: 'Устройство', en: 'Device' },
  readOnly: { ru: 'В этой сборке поле задаёт организатор', en: 'The organizer sets this field in this build' },
  saveSettings: { ru: 'Сохранить настройки', en: 'Save settings' },
  settingsSaved: { ru: 'Настройки сохранены на устройстве', en: 'Settings saved on this device' },
  clearDevice: { ru: 'Очистить устройство', en: 'Clear this device' },
  clearBlocked: {
    ru: 'Очистка заблокирована: неотправленных операций {count}. Сначала нужна передача или подтверждённый экспорт.',
    en: 'Clearing is blocked: {count} operations are unsent. Delivery or a confirmed export has to come first.',
  },
  clearPhrase: { ru: 'Введите ОЧИСТИТЬ', en: 'Type CLEAR' },
  clearAction: { ru: 'Очистить локальный профиль', en: 'Clear the local profile' },
  signOutKeep: { ru: 'Выйти и оставить журнал', en: 'Sign out and keep the journal' },
  signOutClear: { ru: 'Выйти и очистить журнал', en: 'Sign out and clear the journal' },
  signOutBody: {
    ru: 'Выход стирает облачную сессию в памяти. Журнал на устройстве можно оставить.',
    en: 'Signing out clears the cloud session from memory. The journal on the device can stay.',
  },
  checkLink: { ru: 'Проверить связь', en: 'Check the link' },
  syncNow: { ru: 'Синхронизировать сейчас', en: 'Synchronize now' },
  syncLater: {
    ru: 'Отправка идёт, пока приложение открыто. Закрытый браузер доставку не обещает.',
    en: 'Sending runs while the application is open. A closed browser does not promise delivery.',
  },
  ownerMismatch: {
    ru: 'Очередь принадлежит другому профилю и не отправляется.',
    en: 'The queue belongs to another profile and is not sent.',
  },
  hideAccepted: { ru: 'Скрыть принятые', en: 'Hide accepted' },
  nextTry: { ru: 'Следующая попытка', en: 'Next attempt' },
  lastError: { ru: 'Последняя ошибка', en: 'Latest error' },
  showReason: { ru: 'Посмотреть причину', en: 'View the reason' },
  conflictKept: {
    ru: 'Локальная версия сохранена. Серверная запись не перезаписана.',
    en: 'The local version is kept. The server record was not overwritten.',
  },
  noMarkDelivered: { ru: 'Пометить доставленным нельзя: доставку подтверждает только ответ сервера.', en: 'Nothing can be marked delivered: only a server response confirms delivery.' },
  authCard: { ru: 'Авторизация', en: 'Authorization' },
  authOpen: { ru: 'Облачная сессия открыта', en: 'Cloud session is open' },
  authClosed: { ru: 'Облачная сессия не открыта. Локальные записи от этого не исчезают.', en: 'The cloud session is not open. Local records remain.' },
  queueCard: { ru: 'Очередь операций', en: 'Operation queue' },
  queueEmpty: { ru: 'Очередь пуста', en: 'The queue is empty' },
  protectedPart: { ru: 'Защищённая медицинская часть', en: 'Protected medical part' },
  attempts: { ru: 'Попытки', en: 'Attempts' },
  state: { ru: 'Состояние', en: 'State' },
  created: { ru: 'Создано', en: 'Created' },
  groundTitle: { ru: 'Медицинский центр', en: 'Medical center' },
  groundBody: {
    ru: 'Вход врача выполнен. Панель просмотра отчётов откроется на следующем этапе. Чужие записи через этот экран не читаются.',
    en: 'The physician is signed in. The report panel opens in the next stage. This screen does not read anyone else’s records.',
  },
  openSource: { ru: 'Открыть первоисточник', en: 'Open the source' },
  sourceOffline: { ru: 'Для открытия первоисточника нужен интернет', en: 'Opening the original source needs the internet' },
  localExcerpt: { ru: 'Локальная выдержка', en: 'Local excerpt' },
  limitation: { ru: 'Ограничение', en: 'Limitation' },
  reminderNow: { ru: 'Время ежедневной отметки', en: 'Time for the daily note' },
  errors: { ru: 'Проверьте поля', en: 'Check the fields' },
  unitBpm: { ru: 'уд/мин', en: 'bpm' },
  unitC: { ru: '°C', en: '°C' },
  unitPercent: { ru: '%', en: '%' },
} satisfies Record<string, Pair>

export type CopyKey = keyof typeof copy

export function t(locale: Locale, key: CopyKey, vars?: Record<string, string | number>): string {
  let text: string = copy[key][locale]
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(`{${name}}`, String(value))
    }
  }
  return text
}

export const overallLabels = {
  very_poor: { ru: 'Очень плохое', en: 'Very poor' },
  poor: { ru: 'Плохое', en: 'Poor' },
  fair: { ru: 'Среднее', en: 'Fair' },
  good: { ru: 'Хорошее', en: 'Good' },
  very_good: { ru: 'Очень хорошее', en: 'Very good' },
} satisfies Record<string, Pair>

export const emotionalLabels = {
  calm: { ru: 'Спокойное', en: 'Calm' },
  tense: { ru: 'Напряжённое', en: 'Tense' },
  low: { ru: 'Подавленное', en: 'Low' },
  elevated: { ru: 'Приподнятое', en: 'Elevated' },
  other: { ru: 'Другое', en: 'Other' },
  declined: { ru: 'Не хочу отвечать', en: 'I do not want to answer' },
} satisfies Record<string, Pair>

export const contextLabels = {
  after_sleep: { ru: 'После сна', en: 'After sleep' },
  after_exertion: { ru: 'После нагрузки', en: 'After exertion' },
  before_sleep: { ru: 'Перед сном', en: 'Before sleep' },
  other: { ru: 'Другое', en: 'Other' },
} satisfies Record<string, Pair>

export const symptomLabels = {
  headache: { ru: 'Головная боль', en: 'Headache' },
  dizziness: { ru: 'Головокружение', en: 'Dizziness' },
  nausea: { ru: 'Тошнота', en: 'Nausea' },
  abdominal_discomfort: { ru: 'Дискомфорт в животе', en: 'Abdominal discomfort' },
  muscle_joint_pain: { ru: 'Боль в мышцах или суставах', en: 'Muscle or joint pain' },
  palpitations: { ru: 'Ощущение сердцебиения', en: 'Palpitations' },
  other: { ru: 'Другое', en: 'Other' },
} satisfies Record<string, Pair>

export const onsetLabels = {
  now: { ru: 'Сейчас', en: 'Now' },
  earlier_today: { ru: 'Сегодня раньше', en: 'Earlier today' },
  more_than_a_day: { ru: 'Более суток назад', en: 'More than a day ago' },
  unknown: { ru: 'Не знаю', en: "I don't know" },
} satisfies Record<string, Pair>

export const persistenceLabels = {
  constant: { ru: 'Постоянно', en: 'Constant' },
  intermittent: { ru: 'Периодически', en: 'Comes and goes' },
  unknown: { ru: 'Не знаю', en: "I don't know" },
} satisfies Record<string, Pair>

export const impactLabels = {
  none: { ru: 'Не мешает', en: 'Does not interfere' },
  some: { ru: 'Немного', en: 'A little' },
  severe: { ru: 'Сильно', en: 'A lot' },
  cannot_assess: { ru: 'Не могу оценить', en: 'I cannot rate it' },
} satisfies Record<string, Pair>

export function label(locale: Locale, pair: Pair): string {
  return pair[locale]
}

export function issueText(locale: Locale, message: string): string {
  if (message === 'future_limit') {
    return locale === 'ru' ? 'Не больше 5 минут в будущем. Значение не изменено.' : 'No more than 5 minutes in the future. The value was not changed.'
  }
  if (message === 'value_out_of_range' || message === 'out_of_range') return t(locale, 'rangeError')
  if (message === 'custom_label_required') {
    return locale === 'ru' ? 'Для пункта «Другое» нужно название от 2 до 80 символов.' : 'Other needs a name of 2 to 80 characters.'
  }
  if (message === 'required' || message === 'symptoms_required') {
    return locale === 'ru' ? 'Нужен ответ или явный пропуск.' : 'An answer or an explicit skip is required.'
  }
  if (message === 'symptoms_pending_delete') return t(locale, 'deleteSymptoms')
  if (message === 'too_long') return locale === 'ru' ? 'Слишком длинный текст.' : 'The text is too long.'
  return locale === 'ru' ? 'Проверьте поле.' : 'Check this field.'
}
