from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection

SOURCES = [
    {
        "id": "NASA-HRR",
        "title": "NASA Human Research Roadmap",
        "organization": "NASA",
        "url": "https://humanresearchroadmap.nasa.gov/",
        "summary": "Контекст рисков и медицинской автономности при ограниченной связи.",
        "limitations": "Не означает, что правила прототипа одобрены NASA.",
        "kind": "research_context",
    },
    {
        "id": "NASA-HRR-EVIDENCE",
        "title": "Human Research Roadmap Evidence",
        "organization": "NASA",
        "url": "https://humanresearchroadmap.nasa.gov/evidence/",
        "summary": "Исходные отчёты по конкретным рискам. Нужны выбранный отчёт и версия.",
        "limitations": "Любой симптом не указывает автоматически на конкретный риск.",
        "kind": "research_context",
    },
    {
        "id": "NASA-CARE",
        "title": "Health and Medical Care",
        "organization": "NASA",
        "url": "https://www.nasa.gov/reference/3-0-health-and-medical-care/",
        "summary": "Роль медицинской команды и ограничения миссии.",
        "limitations": "Прототип не заявляет соответствие NASA-STD-3001.",
        "kind": "agency_requirement",
    },
    {
        "id": "NASA-BEHAVIOR",
        "title": "Behavioral health research task",
        "organization": "NASA",
        "url": "https://humanresearchroadmap.nasa.gov/Tasks/task.aspx?i=1623",
        "summary": "Контекст изучения сна, усталости, стресса и стандартизированных мер.",
        "limitations": "Короткая анкета прототипа не валидирована как этот инструмент.",
        "kind": "research_context",
    },
    {
        "id": "MDN-SERIAL",
        "title": "Web Serial API",
        "organization": "MDN",
        "url": "https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API",
        "summary": "Разрешение порта, secure context и совместимость браузеров.",
        "limitations": "USB не работает во всех браузерах и на всех телефонах.",
        "kind": "technical_documentation",
    },
]

RULES = [
    ("DATA_CONTACT_LOST_V1", "technical_quality", '{"event":"measurement_incomplete"}', "Правило прототипа. Проверяет полноту сигнала, не медицинскую точность."),
    ("DATA_NO_CURRENT_V1", "technical_quality", '{"event":"checkin_without_measurement"}', "Правило прототипа. Информационное, не тревога."),
    ("SELF_REVIEW_REQUEST_V1", "user_action", '{"event":"review_requested"}', "Правило прототипа. Отражает явный запрос человека, не диагноз."),
    ("SYNC_AUTH_REQUIRED_V1", "technical_quality", '{"event":"auth_refresh_failed"}', "Правило прототипа. Относится к сессии, не к самочувствию."),
    (
        "HISTORY_CHANGE_V1",
        "descriptive_change",
        '{"minimum_observations":5,"minimum_days":3}',
        "Правило прототипа. Личная медиана не является нормой. Источник NASA к порогу не прикреплён.",
    ),
]


def insert_reference(connection: Connection) -> None:
    accessed = date(2026, 11, 13)
    connection.execute(
        text(
            """
            INSERT INTO sources (
                id, title, organization, url, version_date, accessed_at, local_summary, limitations, source_kind
            ) VALUES (
                :id, :title, :organization, :url, NULL, :accessed_at, :summary, :limitations, :kind
            )
            ON CONFLICT (id) DO NOTHING
            """
        ),
        [{**row, "accessed_at": accessed} for row in SOURCES],
    )
    connection.execute(
        text(
            """
            INSERT INTO rule_definitions (rule_id, version, rule_kind, config, source_ids, limitations, demo_only)
            VALUES (:rule_id, '1', :rule_kind, CAST(:config AS jsonb), '{}', :limitations, true)
            ON CONFLICT (rule_id, version) DO NOTHING
            """
        ),
        [
            {"rule_id": rule_id, "rule_kind": kind, "config": config, "limitations": limitations}
            for rule_id, kind, config, limitations in RULES
        ],
    )
