from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

timestamptz = DateTime(timezone=True)


class Account(Base):
    """Login account. No medical fields and no self-registration."""

    __tablename__ = "accounts"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    email: Mapped[str] = mapped_column(Text, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("char_length(email) between 3 and 200", name="email_length"),
        CheckConstraint("char_length(password_hash) between 20 and 200", name="password_hash_length"),
    )


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("accounts.id", ondelete="RESTRICT"), primary_key=True
    )
    display_name: Mapped[str] = mapped_column(Text)
    callsign: Mapped[str] = mapped_column(Text)
    locale: Mapped[str] = mapped_column(Text, server_default=text("'ru'"))
    timezone: Mapped[str] = mapped_column(Text, server_default=text("'UTC'"))
    unit_system: Mapped[str] = mapped_column(Text, server_default=text("'metric'"))
    created_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("char_length(display_name) between 1 and 100", name="display_name_length"),
        CheckConstraint("char_length(callsign) between 2 and 20", name="callsign_length"),
        CheckConstraint("locale in ('ru', 'en')", name="locale_values"),
        CheckConstraint("timezone ~ '^[A-Za-z0-9_+./-]{1,64}$'", name="timezone_shape"),
        CheckConstraint("unit_system in ('metric', 'us')", name="unit_system_values"),
    )


class Mission(Base):
    __tablename__ = "missions"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    start_at: Mapped[datetime] = mapped_column(timestamptz)
    end_at: Mapped[datetime] = mapped_column(timestamptz)
    mode: Mapped[str] = mapped_column(Text)
    default_timezone: Mapped[str] = mapped_column(Text, server_default=text("'UTC'"))
    emergency_contact_text: Mapped[str] = mapped_column(Text, server_default=text("''"))
    ruleset_version: Mapped[str] = mapped_column(Text)
    demo_dataset_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("code ~ '^[A-Za-z0-9-]{3,20}$'", name="code_shape"),
        CheckConstraint("char_length(name) between 3 and 80", name="name_length"),
        CheckConstraint("end_at > start_at", name="mission_window"),
        CheckConstraint("mode in ('short', 'extended')", name="mode_values"),
        CheckConstraint("default_timezone ~ '^[A-Za-z0-9_+./-]{1,64}$'", name="default_timezone_shape"),
        CheckConstraint("char_length(emergency_contact_text) <= 2000", name="emergency_length"),
        CheckConstraint("char_length(ruleset_version) between 1 and 40", name="ruleset_length"),
    )


class MissionMembership(Base):
    __tablename__ = "mission_memberships"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    role: Mapped[str] = mapped_column(Text)
    active_from: Mapped[datetime] = mapped_column(timestamptz)
    active_until: Mapped[datetime | None] = mapped_column(timestamptz)
    created_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("role in ('astronaut', 'doctor', 'commander', 'admin')", name="role_values"),
        CheckConstraint("active_until is null or active_until > active_from", name="active_window"),
        Index(
            "mission_memberships_one_active",
            "mission_id",
            "user_id",
            unique=True,
            postgresql_where=text("active_until IS NULL"),
        ),
    )


class MedicalAssignment(Base):
    __tablename__ = "medical_assignments"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    patient_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    doctor_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    valid_from: Mapped[datetime] = mapped_column(timestamptz)
    valid_until: Mapped[datetime | None] = mapped_column(timestamptz)
    revoked_at: Mapped[datetime | None] = mapped_column(timestamptz)
    created_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("patient_id <> doctor_id", name="distinct_parties"),
        CheckConstraint("valid_until is null or valid_until > valid_from", name="valid_window"),
        Index(
            "medical_assignments_one_active",
            "mission_id",
            "patient_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
        Index(
            "medical_assignments_doctor_idx",
            "doctor_id",
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )


class MedicalProfile(Base):
    __tablename__ = "medical_profiles"

    subject_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"), primary_key=True
    )
    age: Mapped[int | None] = mapped_column(Integer)
    sex_context: Mapped[str | None] = mapped_column(Text)
    updated_revision: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    updated_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("age is null or age between 18 and 100", name="age_range"),
        CheckConstraint(
            "sex_context is null or sex_context in ('female', 'male', 'intersex', 'unspecified')",
            name="sex_context_values",
        ),
        CheckConstraint("updated_revision >= 1", name="revision_positive"),
    )


class PersonalPreference(Base):
    __tablename__ = "personal_preferences"

    subject_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"), primary_key=True
    )
    reproductive_enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    cycle_context: Mapped[str | None] = mapped_column(Text)
    default_sharing: Mapped[str] = mapped_column(Text, server_default=text("'device_only'"))
    revision: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    updated_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint(
            "cycle_context is null or cycle_context in ('natural', 'suppression_regimen', 'other')",
            name="cycle_context_values",
        ),
        CheckConstraint("default_sharing in ('device_only', 'assigned_doctor')", name="sharing_values"),
        CheckConstraint("revision >= 1", name="revision_positive"),
    )


class ConsentEvent(Base):
    __tablename__ = "consent_events"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    scope: Mapped[str] = mapped_column(Text)
    decision: Mapped[str] = mapped_column(Text)
    assignment_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("medical_assignments.id", ondelete="RESTRICT")
    )
    supersedes_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("consent_events.id", ondelete="RESTRICT")
    )
    recorded_at: Mapped[datetime] = mapped_column(timestamptz)
    effective_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))
    schema_version: Mapped[int] = mapped_column(Integer)
    created_at_device: Mapped[datetime] = mapped_column(timestamptz)
    demo_dataset_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    __table_args__ = (
        CheckConstraint("scope in ('general_exchange', 'personal_sharing')", name="scope_values"),
        CheckConstraint("decision in ('granted', 'revoked')", name="decision_values"),
        CheckConstraint("schema_version = 1", name="schema_version"),
        Index("consent_events_latest_idx", "subject_id", "scope", "effective_at_server"),
    )


class Checkin(Base):
    __tablename__ = "checkins"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    device_id: Mapped[str] = mapped_column(Text)
    schema_version: Mapped[int] = mapped_column(Integer)
    local_date: Mapped[date] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text)
    root_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True))
    recorded_at: Mapped[datetime] = mapped_column(timestamptz)
    created_at_device: Mapped[datetime] = mapped_column(timestamptz)
    created_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))
    source: Mapped[str] = mapped_column(Text)
    demo_dataset_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    __table_args__ = (
        CheckConstraint("author_id = subject_id", name="author_is_subject"),
        CheckConstraint("schema_version = 1", name="schema_version"),
        CheckConstraint("device_id ~ '^[A-Za-z0-9_.:-]{1,128}$'", name="device_id_shape"),
        CheckConstraint("timezone ~ '^[A-Za-z0-9_+./-]{1,64}$'", name="timezone_shape"),
        CheckConstraint("type in ('daily', 'change')", name="type_values"),
        CheckConstraint("source in ('manual', 'usb', 'simulated')", name="source_values"),
        Index("checkins_subject_mission_idx", "subject_id", "mission_id"),
    )


class CheckinRevision(Base):
    __tablename__ = "checkin_revisions"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    checkin_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("checkins.id", ondelete="RESTRICT"))
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    parent_revision_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("checkin_revisions.id", ondelete="RESTRICT")
    )
    revision_no: Mapped[int] = mapped_column(Integer)
    general_payload: Mapped[dict] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    schema_version: Mapped[int] = mapped_column(Integer)
    payload_hash: Mapped[str] = mapped_column(Text)
    created_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("checkin_id", "revision_no", name="uq_checkin_revisions_number"),
        CheckConstraint("revision_no >= 1", name="revision_no_positive"),
        CheckConstraint("reason is null or char_length(reason) between 1 and 300", name="reason_length"),
        CheckConstraint("schema_version = 1", name="schema_version"),
        CheckConstraint("payload_hash ~ '^[0-9a-f]{64}$'", name="payload_hash_shape"),
        Index("checkin_revisions_subject_idx", "subject_id", "mission_id"),
    )


class CheckinPersonalRevision(Base):
    __tablename__ = "checkin_personal_revisions"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    general_revision_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("checkin_revisions.id", ondelete="RESTRICT"), unique=True
    )
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    personal_payload: Mapped[dict] = mapped_column(JSONB)
    consent_event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("consent_events.id", ondelete="RESTRICT")
    )
    payload_hash: Mapped[str] = mapped_column(Text)
    schema_version: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint("schema_version = 1", name="schema_version"),
        CheckConstraint("payload_hash ~ '^[0-9a-f]{64}$'", name="payload_hash_shape"),
        Index("checkin_personal_subject_idx", "subject_id", "mission_id"),
    )


class Measurement(Base):
    __tablename__ = "measurements"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    device_id: Mapped[str] = mapped_column(Text)
    metric: Mapped[str] = mapped_column(Text)
    value: Mapped[float | None] = mapped_column(Numeric(8, 2))
    unit: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    quality: Mapped[str] = mapped_column(Text)
    quality_reasons: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    context: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    device_metadata: Mapped[dict | None] = mapped_column(JSONB)
    algorithm_version: Mapped[str | None] = mapped_column(Text)
    attempt_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    schema_version: Mapped[int] = mapped_column(Integer)
    recorded_at: Mapped[datetime] = mapped_column(timestamptz)
    created_at_device: Mapped[datetime] = mapped_column(timestamptz)
    created_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))
    demo_dataset_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    __table_args__ = (
        CheckConstraint("author_id = subject_id", name="author_is_subject"),
        CheckConstraint("schema_version = 1", name="schema_version"),
        CheckConstraint("device_id ~ '^[A-Za-z0-9_.:-]{1,128}$'", name="device_id_shape"),
        CheckConstraint("metric in ('heart_rate', 'temperature', 'spo2', 'body_mass')", name="metric_values"),
        CheckConstraint("unit in ('bpm', 'celsius', 'percent', 'kg')", name="unit_values"),
        CheckConstraint("source in ('manual', 'usb', 'simulated')", name="source_values"),
        CheckConstraint("quality in ('unknown', 'valid', 'invalid', 'insufficient')", name="quality_values"),
        CheckConstraint(
            "context is null or context in ('rest', 'after_exertion', 'other', 'unspecified')",
            name="context_values",
        ),
        CheckConstraint("note is null or char_length(note) between 1 and 300", name="note_length"),
        CheckConstraint(
            "algorithm_version is null or char_length(algorithm_version) between 1 and 40",
            name="algorithm_version_length",
        ),
        CheckConstraint(
            "(quality in ('invalid', 'insufficient') and value is null) "
            "or (quality in ('unknown', 'valid') and value is not null)",
            name="quality_value",
        ),
        CheckConstraint(
            "(metric = 'heart_rate' and unit = 'bpm' and (value is null or (value = trunc(value) and value between 20 and 250))) "
            "or (metric = 'temperature' and unit = 'celsius' and (value is null or (value between 30 and 45 and value * 10 = trunc(value * 10)))) "
            "or (metric = 'spo2' and unit = 'percent' and (value is null or (value = trunc(value) and value between 50 and 100))) "
            "or (metric = 'body_mass' and unit = 'kg' and (value is null or (value between 20 and 300 and value * 10 = trunc(value * 10))))",
            name="metric_unit_range",
        ),
        Index("measurements_subject_idx", "subject_id", "mission_id", "recorded_at"),
    )


class CheckinMeasurement(Base):
    __tablename__ = "checkin_measurements"

    revision_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("checkin_revisions.id", ondelete="RESTRICT"), primary_key=True
    )
    measurement_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("measurements.id", ondelete="RESTRICT"), primary_key=True
    )
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))


class InvalidationEvent(Base):
    __tablename__ = "invalidation_events"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    target_type: Mapped[str] = mapped_column(Text)
    target_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True))
    reason: Mapped[str] = mapped_column(Text)
    device_id: Mapped[str] = mapped_column(Text)
    recorded_at: Mapped[datetime] = mapped_column(timestamptz)
    created_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("author_id = subject_id", name="author_is_subject"),
        CheckConstraint("target_type in ('checkin', 'measurement', 'report')", name="target_type_values"),
        CheckConstraint("char_length(reason) between 1 and 300", name="reason_length"),
        CheckConstraint("device_id ~ '^[A-Za-z0-9_.:-]{1,128}$'", name="device_id_shape"),
    )


class Observation(Base):
    __tablename__ = "observations"
    __table_args__ = (
        CheckConstraint("char_length(rule_id) between 1 and 80", name="rule_id_length"),
        CheckConstraint("char_length(rule_version) between 1 and 40", name="rule_version_length"),
        CheckConstraint("visibility in ('subject', 'assigned_doctor')", name="visibility_values"),
        {"comment": "General engineering observations only. Sensitive derivatives are not stored here."},
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    rule_id: Mapped[str] = mapped_column(Text)
    rule_version: Mapped[str] = mapped_column(Text)
    input_refs: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict] = mapped_column(JSONB)
    visibility: Mapped[str] = mapped_column(Text)
    created_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    recipient_assignment_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("medical_assignments.id", ondelete="RESTRICT")
    )
    title: Mapped[str] = mapped_column(Text)
    range_start: Mapped[date] = mapped_column(Date)
    range_end: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(Text)
    message: Mapped[str | None] = mapped_column(Text)
    general_snapshot: Mapped[dict] = mapped_column(JSONB)
    general_hash: Mapped[str] = mapped_column(Text)
    parent_report_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("reports.id", ondelete="RESTRICT")
    )
    schema_version: Mapped[int] = mapped_column(Integer)
    device_id: Mapped[str] = mapped_column(Text)
    recorded_at: Mapped[datetime] = mapped_column(timestamptz)
    created_at_device: Mapped[datetime] = mapped_column(timestamptz)
    created_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))
    demo_dataset_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    __table_args__ = (
        CheckConstraint("author_id = subject_id", name="author_is_subject"),
        CheckConstraint("char_length(title) between 1 and 120", name="title_length"),
        CheckConstraint("range_end >= range_start", name="range_order"),
        CheckConstraint("reason in ('planned', 'review_request', 'reply_to_doctor')", name="reason_values"),
        CheckConstraint("message is null or char_length(message) between 1 and 2000", name="message_length"),
        CheckConstraint("general_hash ~ '^[0-9a-f]{64}$'", name="general_hash_shape"),
        CheckConstraint("schema_version = 1", name="schema_version"),
        CheckConstraint("device_id ~ '^[A-Za-z0-9_.:-]{1,128}$'", name="device_id_shape"),
        Index("reports_subject_idx", "subject_id", "mission_id"),
    )


class ReportPersonalPart(Base):
    __tablename__ = "report_personal_parts"

    report_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("reports.id", ondelete="RESTRICT"), primary_key=True
    )
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    personal_snapshot: Mapped[dict] = mapped_column(JSONB)
    personal_hash: Mapped[str] = mapped_column(Text)
    consent_event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("consent_events.id", ondelete="RESTRICT")
    )
    schema_version: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint("personal_hash ~ '^[0-9a-f]{64}$'", name="personal_hash_shape"),
        CheckConstraint("schema_version = 1", name="schema_version"),
    )


class ReportEvent(Base):
    __tablename__ = "report_events"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    report_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("reports.id", ondelete="RESTRICT"))
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    event_type: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    server_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint(
            "event_type in ('accepted', 'opened', 'replied', 'device_received', 'patient_read')",
            name="event_type_values",
        ),
    )


class DoctorMessage(Base):
    __tablename__ = "doctor_messages"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    report_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("reports.id", ondelete="RESTRICT"))
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    message_type: Mapped[str] = mapped_column(Text)
    message_text: Mapped[str] = mapped_column(Text)
    sensitive: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    supersedes_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("doctor_messages.id", ondelete="RESTRICT")
    )
    created_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("message_type in ('acknowledgement', 'clarifying_question', 'comment')", name="message_type_values"),
        CheckConstraint("char_length(message_text) between 1 and 3000", name="message_text_length"),
        CheckConstraint("sensitive = false", name="sensitive_always_false"),
    )


class DoctorPersonalMessage(Base):
    __tablename__ = "doctor_personal_messages"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    report_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("reports.id", ondelete="RESTRICT"))
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    message_type: Mapped[str] = mapped_column(Text)
    message_text: Mapped[str] = mapped_column(Text)
    supersedes_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("doctor_personal_messages.id", ondelete="RESTRICT")
    )
    created_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("message_type in ('acknowledgement', 'clarifying_question', 'comment')", name="message_type_values"),
        CheckConstraint("char_length(message_text) between 1 and 3000", name="message_text_length"),
    )


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    organization: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text)
    version_date: Mapped[date | None] = mapped_column(Date)
    accessed_at: Mapped[date] = mapped_column(Date)
    local_summary: Mapped[str] = mapped_column(Text)
    limitations: Mapped[str] = mapped_column(Text)
    source_kind: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("id ~ '^[A-Z0-9-]{3,40}$'", name="id_shape"),
        CheckConstraint("char_length(title) between 1 and 200", name="title_length"),
        CheckConstraint("char_length(organization) between 1 and 120", name="organization_length"),
        CheckConstraint("char_length(url) between 1 and 500", name="url_length"),
        CheckConstraint("char_length(local_summary) between 1 and 2000", name="summary_length"),
        CheckConstraint("char_length(limitations) between 1 and 2000", name="limitations_length"),
        CheckConstraint(
            "source_kind in ('research_context', 'agency_requirement', 'technical_documentation', 'prototype_rule')",
            name="source_kind_values",
        ),
    )


class RuleDefinition(Base):
    __tablename__ = "rule_definitions"

    rule_id: Mapped[str] = mapped_column(Text, primary_key=True)
    version: Mapped[str] = mapped_column(Text, primary_key=True)
    rule_kind: Mapped[str] = mapped_column(Text)
    config: Mapped[dict] = mapped_column(JSONB)
    source_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))
    limitations: Mapped[str] = mapped_column(Text)
    demo_only: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    __table_args__ = (
        CheckConstraint("rule_id ~ '^[A-Z0-9_]{3,80}$'", name="rule_id_shape"),
        CheckConstraint("char_length(version) between 1 and 40", name="version_length"),
        CheckConstraint(
            "rule_kind in ('user_action', 'technical_quality', 'descriptive_change')",
            name="rule_kind_values",
        ),
        CheckConstraint("char_length(limitations) between 1 and 2000", name="limitations_length"),
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = ({"comment": "No medical text, tokens, or free-text comments."},)

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    actor_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    action: Mapped[str] = mapped_column(Text)
    entity_type: Mapped[str] = mapped_column(Text)
    entity_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    occurred_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))
    request_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))


class OperationalStatus(Base):
    __tablename__ = "operational_statuses"
    __table_args__ = (
        CheckConstraint("status in ('available', 'load_adjustment', 'do_not_publish')", name="status_values"),
        {"comment": "P1 projection for the commander. No medical fields."},
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(timestamptz)
    revoked_at: Mapped[datetime | None] = mapped_column(timestamptz)
    published_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))


class CareOrder(Base):
    """Physician care task. Not a prescription and not a clinical decision support output."""

    __tablename__ = "care_orders"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    assignment_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("medical_assignments.id", ondelete="RESTRICT")
    )
    doctor_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    goal: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str] = mapped_column(Text)
    schedule_text: Mapped[str] = mapped_column(Text, server_default=text("''"))
    start_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))
    review_at: Mapped[datetime | None] = mapped_column(timestamptz)
    due_at: Mapped[datetime | None] = mapped_column(timestamptz)
    status: Mapped[str] = mapped_column(Text, server_default=text("'active'"))
    revision_no: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    parent_order_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("care_orders.id", ondelete="RESTRICT")
    )
    cancelled_reason: Mapped[str | None] = mapped_column(Text)
    revise_reason: Mapped[str | None] = mapped_column(Text)
    ack_required: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    acknowledged_at: Mapped[datetime | None] = mapped_column(timestamptz)
    schema_version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint(
            "kind in ('examination', 'measurement', 'recommendation', 'symptom_monitor', 'follow_up', 'workout')",
            name="care_order_kind_values",
        ),
        CheckConstraint("status in ('active', 'cancelled', 'completed')", name="care_order_status_values"),
        CheckConstraint("char_length(title) between 1 and 120", name="care_order_title_length"),
        CheckConstraint("goal is null or char_length(goal) between 1 and 500", name="care_order_goal_length"),
        CheckConstraint("char_length(instructions) between 1 and 3000", name="care_order_instructions_length"),
        CheckConstraint("char_length(schedule_text) <= 500", name="care_order_schedule_length"),
        CheckConstraint(
            "cancelled_reason is null or char_length(cancelled_reason) between 1 and 500",
            name="care_order_cancel_reason_length",
        ),
        CheckConstraint(
            "revise_reason is null or char_length(revise_reason) between 1 and 500",
            name="care_order_revise_reason_length",
        ),
        CheckConstraint("revision_no >= 1", name="care_order_revision_no"),
        CheckConstraint("schema_version = 1", name="care_order_schema_version"),
        Index("care_orders_subject_idx", "subject_id", "mission_id", "status"),
    )


class CareOrderEvent(Base):
    __tablename__ = "care_order_events"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    order_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("care_orders.id", ondelete="RESTRICT"))
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    event_type: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    detail: Mapped[str | None] = mapped_column(Text)
    server_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint(
            "event_type in ("
            "'created', 'revised', 'cancelled', 'completed_by_crew', 'skipped_by_crew', "
            "'unable_by_crew', 'acknowledged')",
            name="care_order_event_type_values",
        ),
        CheckConstraint("detail is null or char_length(detail) <= 500", name="care_order_event_detail_length"),
        Index("care_order_events_order_idx", "order_id", "server_at"),
    )


class CareOrderResponse(Base):
    __tablename__ = "care_order_responses"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    order_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("care_orders.id", ondelete="RESTRICT"))
    subject_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    mission_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("missions.id", ondelete="RESTRICT"))
    decision: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    link_note: Mapped[str | None] = mapped_column(Text)
    activity_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    recorded_at: Mapped[datetime] = mapped_column(timestamptz)
    created_at_device: Mapped[datetime] = mapped_column(timestamptz)
    operation_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True))
    payload_hash: Mapped[str] = mapped_column(Text)
    created_at_server: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("operation_id", name="uq_care_order_responses_operation_id"),
        CheckConstraint(
            "decision in ('done', 'skipped', 'acknowledged', 'unable')",
            name="care_order_decision_values",
        ),
        CheckConstraint("note is null or char_length(note) between 1 and 1000", name="care_order_note_length"),
        CheckConstraint(
            "link_note is null or char_length(link_note) between 1 and 300",
            name="care_order_link_note_length",
        ),
        CheckConstraint("payload_hash ~ '^[0-9a-f]{64}$'", name="care_order_response_hash_shape"),
        Index("care_order_responses_order_idx", "order_id", "created_at_server"),
    )


class SyncReceipt(Base):
    """Idempotency receipt. A separate table with no HTTP read route."""

    __tablename__ = "sync_receipts"
    __table_args__ = (
        UniqueConstraint("operation_id", name="uq_sync_receipts_operation_id"),
        CheckConstraint(
            "operation_type in ("
            "'checkin_bundle', 'measurement', 'report_bundle', 'invalidation', "
            "'profile_preferences', 'consent_change', 'care_order_response', 'report_ack')",
            name="operation_type_values",
        ),
        CheckConstraint("payload_hash ~ '^[0-9a-f]{64}$'", name="payload_hash_shape"),
        {"schema": "private"},
    )

    receipt_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    operation_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True))
    actor_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"))
    operation_type: Mapped[str] = mapped_column(Text)
    payload_hash: Mapped[str] = mapped_column(Text)
    entity_refs: Mapped[dict] = mapped_column(JSONB)
    accepted_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))


class ChangeLog(Base):
    __tablename__ = "change_log"
    __table_args__ = ({"schema": "private"},)

    position: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    scope: Mapped[str] = mapped_column(Text)
    entity_type: Mapped[str] = mapped_column(Text)
    entity_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True))
    actor_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True))
    occurred_at: Mapped[datetime] = mapped_column(timestamptz, server_default=text("now()"))
