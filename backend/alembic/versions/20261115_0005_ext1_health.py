"""EXT-1: body mass metric, care plan goal/start/review, unable decision, link_note.

Revision ID: 20261115_0005
Revises: 20261115_0004
Create Date: 2026-11-15
"""

from __future__ import annotations

from alembic import op

revision = "20261115_0005"
down_revision = "20261115_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE measurements DROP CONSTRAINT IF EXISTS metric_values")
    op.execute("ALTER TABLE measurements DROP CONSTRAINT IF EXISTS unit_values")
    op.execute("ALTER TABLE measurements DROP CONSTRAINT IF EXISTS metric_unit_range")
    op.execute(
        """
        ALTER TABLE measurements
        ADD CONSTRAINT metric_values
        CHECK (metric in ('heart_rate', 'temperature', 'spo2', 'body_mass'))
        """
    )
    op.execute(
        """
        ALTER TABLE measurements
        ADD CONSTRAINT unit_values
        CHECK (unit in ('bpm', 'celsius', 'percent', 'kg'))
        """
    )
    op.execute(
        """
        ALTER TABLE measurements
        ADD CONSTRAINT metric_unit_range
        CHECK (
            (metric = 'heart_rate' and unit = 'bpm' and (value is null or (value = trunc(value) and value between 20 and 250)))
            or (metric = 'temperature' and unit = 'celsius' and (value is null or (value between 30 and 45 and value * 10 = trunc(value * 10))))
            or (metric = 'spo2' and unit = 'percent' and (value is null or (value = trunc(value) and value between 50 and 100)))
            or (metric = 'body_mass' and unit = 'kg' and (value is null or (value between 20 and 300 and value * 10 = trunc(value * 10))))
        )
        """
    )

    op.execute("ALTER TABLE care_orders ADD COLUMN IF NOT EXISTS goal text")
    op.execute("ALTER TABLE care_orders ADD COLUMN IF NOT EXISTS start_at timestamptz")
    op.execute("ALTER TABLE care_orders ADD COLUMN IF NOT EXISTS review_at timestamptz")
    op.execute("UPDATE care_orders SET start_at = created_at WHERE start_at IS NULL")
    op.execute("ALTER TABLE care_orders ALTER COLUMN start_at SET NOT NULL")
    op.execute("ALTER TABLE care_orders ALTER COLUMN start_at SET DEFAULT now()")
    op.execute("ALTER TABLE care_orders DROP CONSTRAINT IF EXISTS care_order_goal_length")
    op.execute(
        """
        ALTER TABLE care_orders
        ADD CONSTRAINT care_order_goal_length
        CHECK (goal is null or char_length(goal) between 1 and 500)
        """
    )

    op.execute("ALTER TABLE care_order_events DROP CONSTRAINT IF EXISTS care_order_event_type_values")
    op.execute(
        """
        ALTER TABLE care_order_events
        ADD CONSTRAINT care_order_event_type_values
        CHECK (event_type in (
            'created', 'revised', 'cancelled', 'completed_by_crew',
            'skipped_by_crew', 'unable_by_crew', 'acknowledged'
        ))
        """
    )

    op.execute("ALTER TABLE care_order_responses ADD COLUMN IF NOT EXISTS link_note text")
    op.execute("ALTER TABLE care_order_responses DROP CONSTRAINT IF EXISTS care_order_decision_values")
    op.execute(
        """
        ALTER TABLE care_order_responses
        ADD CONSTRAINT care_order_decision_values
        CHECK (decision in ('done', 'skipped', 'acknowledged', 'unable'))
        """
    )
    op.execute("ALTER TABLE care_order_responses DROP CONSTRAINT IF EXISTS care_order_link_note_length")
    op.execute(
        """
        ALTER TABLE care_order_responses
        ADD CONSTRAINT care_order_link_note_length
        CHECK (link_note is null or char_length(link_note) between 1 and 300)
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE care_order_responses DROP CONSTRAINT IF EXISTS care_order_link_note_length")
    op.execute("ALTER TABLE care_order_responses DROP COLUMN IF EXISTS link_note")
    op.execute("ALTER TABLE care_order_responses DROP CONSTRAINT IF EXISTS care_order_decision_values")
    op.execute(
        """
        ALTER TABLE care_order_responses
        ADD CONSTRAINT care_order_decision_values
        CHECK (decision in ('done', 'skipped', 'acknowledged'))
        """
    )
    op.execute("ALTER TABLE care_order_events DROP CONSTRAINT IF EXISTS care_order_event_type_values")
    op.execute(
        """
        ALTER TABLE care_order_events
        ADD CONSTRAINT care_order_event_type_values
        CHECK (event_type in (
            'created', 'revised', 'cancelled', 'completed_by_crew', 'skipped_by_crew', 'acknowledged'
        ))
        """
    )
    op.execute("ALTER TABLE care_orders DROP CONSTRAINT IF EXISTS care_order_goal_length")
    op.execute("ALTER TABLE care_orders DROP COLUMN IF EXISTS review_at")
    op.execute("ALTER TABLE care_orders DROP COLUMN IF EXISTS start_at")
    op.execute("ALTER TABLE care_orders DROP COLUMN IF EXISTS goal")

    op.execute("ALTER TABLE measurements DROP CONSTRAINT IF EXISTS metric_unit_range")
    op.execute("ALTER TABLE measurements DROP CONSTRAINT IF EXISTS unit_values")
    op.execute("ALTER TABLE measurements DROP CONSTRAINT IF EXISTS metric_values")
    op.execute(
        """
        ALTER TABLE measurements
        ADD CONSTRAINT metric_values CHECK (metric in ('heart_rate', 'temperature', 'spo2'))
        """
    )
    op.execute(
        """
        ALTER TABLE measurements
        ADD CONSTRAINT unit_values CHECK (unit in ('bpm', 'celsius', 'percent'))
        """
    )
    op.execute(
        """
        ALTER TABLE measurements
        ADD CONSTRAINT metric_unit_range
        CHECK (
            (metric = 'heart_rate' and unit = 'bpm' and (value is null or (value = trunc(value) and value between 20 and 250)))
            or (metric = 'temperature' and unit = 'celsius' and (value is null or (value between 30 and 45 and value * 10 = trunc(value * 10))))
            or (metric = 'spo2' and unit = 'percent' and (value is null or (value = trunc(value) and value between 50 and 100)))
        )
        """
    )
