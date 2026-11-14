"""Care orders loop without medication prescribing."""

from alembic import op

revision = "20261115_0002"
down_revision = "20261114_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS care_orders (
            id UUID PRIMARY KEY,
            mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
            subject_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
            assignment_id UUID NOT NULL REFERENCES medical_assignments(id) ON DELETE RESTRICT,
            doctor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            instructions TEXT NOT NULL,
            schedule_text TEXT NOT NULL DEFAULT '',
            due_at TIMESTAMPTZ,
            status TEXT NOT NULL DEFAULT 'active',
            revision_no INTEGER NOT NULL DEFAULT 1,
            parent_order_id UUID REFERENCES care_orders(id) ON DELETE RESTRICT,
            cancelled_reason TEXT,
            revise_reason TEXT,
            ack_required BOOLEAN NOT NULL DEFAULT false,
            acknowledged_at TIMESTAMPTZ,
            schema_version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT care_order_kind_values CHECK (
                kind in ('examination', 'measurement', 'recommendation', 'symptom_monitor', 'follow_up')
            ),
            CONSTRAINT care_order_status_values CHECK (status in ('active', 'cancelled', 'completed')),
            CONSTRAINT care_order_title_length CHECK (char_length(title) between 1 and 120),
            CONSTRAINT care_order_instructions_length CHECK (char_length(instructions) between 1 and 3000),
            CONSTRAINT care_order_schedule_length CHECK (char_length(schedule_text) <= 500),
            CONSTRAINT care_order_cancel_reason_length CHECK (
                cancelled_reason is null or char_length(cancelled_reason) between 1 and 500
            ),
            CONSTRAINT care_order_revise_reason_length CHECK (
                revise_reason is null or char_length(revise_reason) between 1 and 500
            ),
            CONSTRAINT care_order_revision_no CHECK (revision_no >= 1),
            CONSTRAINT care_order_schema_version CHECK (schema_version = 1)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS care_orders_subject_idx ON care_orders (subject_id, mission_id, status)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS care_order_events (
            id UUID PRIMARY KEY,
            order_id UUID NOT NULL REFERENCES care_orders(id) ON DELETE RESTRICT,
            subject_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
            mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
            event_type TEXT NOT NULL,
            actor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
            detail TEXT,
            server_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT care_order_event_type_values CHECK (
                event_type in (
                    'created', 'revised', 'cancelled',
                    'completed_by_crew', 'skipped_by_crew', 'acknowledged'
                )
            ),
            CONSTRAINT care_order_event_detail_length CHECK (detail is null or char_length(detail) <= 500)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS care_order_events_order_idx ON care_order_events (order_id, server_at)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS care_order_responses (
            id UUID PRIMARY KEY,
            order_id UUID NOT NULL REFERENCES care_orders(id) ON DELETE RESTRICT,
            subject_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
            mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
            decision TEXT NOT NULL,
            note TEXT,
            recorded_at TIMESTAMPTZ NOT NULL,
            created_at_device TIMESTAMPTZ NOT NULL,
            operation_id UUID NOT NULL,
            payload_hash TEXT NOT NULL,
            created_at_server TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_care_order_responses_operation_id UNIQUE (operation_id),
            CONSTRAINT care_order_decision_values CHECK (decision in ('done', 'skipped', 'acknowledged')),
            CONSTRAINT care_order_note_length CHECK (note is null or char_length(note) between 1 and 1000),
            CONSTRAINT care_order_response_hash_shape CHECK (payload_hash ~ '^[0-9a-f]{64}$')
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS care_order_responses_order_idx ON care_order_responses (order_id, created_at_server)"
    )
    op.execute("ALTER TABLE private.sync_receipts DROP CONSTRAINT IF EXISTS operation_type_values")
    op.execute(
        """
        ALTER TABLE private.sync_receipts
        ADD CONSTRAINT operation_type_values CHECK (
            operation_type in (
                'checkin_bundle', 'measurement', 'report_bundle', 'invalidation',
                'profile_preferences', 'consent_change', 'care_order_response'
            )
        )
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE private.sync_receipts DROP CONSTRAINT IF EXISTS operation_type_values")
    op.execute(
        """
        ALTER TABLE private.sync_receipts
        ADD CONSTRAINT operation_type_values CHECK (
            operation_type in (
                'checkin_bundle', 'measurement', 'report_bundle', 'invalidation',
                'profile_preferences', 'consent_change'
            )
        )
        """
    )
    op.execute("DROP TABLE IF EXISTS care_order_responses")
    op.execute("DROP TABLE IF EXISTS care_order_events")
    op.execute("DROP TABLE IF EXISTS care_orders")
