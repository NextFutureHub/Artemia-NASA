export type EvidenceKind = 'research_context' | 'agency_requirement' | 'technical_documentation' | 'prototype_rule'

export type EvidenceCard = {
  id: string
  title: string
  organization: string
  url: string
  summary: string
  limitations: string
  kind: EvidenceKind
  accessedAt: string
}

export const EVIDENCE_CHECKED_AT = '2026-11-13'

export const EVIDENCE_CATALOG: EvidenceCard[] = [
  {
    id: 'NASA-HRR',
    title: 'NASA Human Research Roadmap',
    organization: 'NASA',
    url: 'https://humanresearchroadmap.nasa.gov/',
    summary: 'Контекст рисков и медицинской автономности при ограниченной связи.',
    limitations: 'Не означает, что правила прототипа одобрены NASA.',
    kind: 'research_context',
    accessedAt: EVIDENCE_CHECKED_AT,
  },
  {
    id: 'NASA-HRR-EVIDENCE',
    title: 'Human Research Roadmap Evidence',
    organization: 'NASA',
    url: 'https://humanresearchroadmap.nasa.gov/evidence/',
    summary: 'Исходные отчёты по конкретным рискам. Нужны выбранный отчёт и версия.',
    limitations: 'Любой симптом не указывает автоматически на конкретный риск.',
    kind: 'research_context',
    accessedAt: EVIDENCE_CHECKED_AT,
  },
  {
    id: 'NASA-CARE',
    title: 'Health and Medical Care',
    organization: 'NASA',
    url: 'https://www.nasa.gov/reference/3-0-health-and-medical-care/',
    summary: 'Роль медицинской команды и ограничения миссии.',
    limitations: 'Прототип не заявляет соответствие NASA-STD-3001.',
    kind: 'agency_requirement',
    accessedAt: EVIDENCE_CHECKED_AT,
  },
  {
    id: 'NASA-BEHAVIOR',
    title: 'Behavioral health research task',
    organization: 'NASA',
    url: 'https://humanresearchroadmap.nasa.gov/Tasks/task.aspx?i=1623',
    summary: 'Контекст изучения сна, усталости, стресса и стандартизированных мер.',
    limitations: 'Короткая анкета прототипа не валидирована как этот инструмент.',
    kind: 'research_context',
    accessedAt: EVIDENCE_CHECKED_AT,
  },
  {
    id: 'MDN-SERIAL',
    title: 'Web Serial API',
    organization: 'MDN',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API',
    summary: 'Разрешение порта, secure context и совместимость браузеров.',
    limitations: 'USB не работает во всех браузерах и на всех телефонах.',
    kind: 'technical_documentation',
    accessedAt: EVIDENCE_CHECKED_AT,
  },
  {
    id: 'LIMITS-P0',
    title: 'Ограничения прототипа',
    organization: 'Artemia',
    url: '',
    summary: 'Локальное сохранение, доставка через API и ручной ввод работают в этой сборке. Врач читает сервер, пока вкладка открыта.',
    limitations: 'Нет гарантированной доставки при закрытом браузере, клинической оценки датчика, автоматической срочности и офлайн-кэша врача.',
    kind: 'prototype_rule',
    accessedAt: EVIDENCE_CHECKED_AT,
  },
]

export function visibleEvidence(query: string, kind: EvidenceKind | 'all', cards: EvidenceCard[] = EVIDENCE_CATALOG): EvidenceCard[] {
  const needle = query.trim().toLowerCase()
  return cards.filter((card) => (kind === 'all' || card.kind === kind) && (needle === '' || card.title.toLowerCase().includes(needle)))
}
