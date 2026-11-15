"""EXT-1 stage-2: workout care kind, activity_id on care responses.

Revision ID: 20261115_0006
Revises: 20261115_0005
Create Date: 2026-11-15

Sleep intervals live inside general_payload JSON (no table). Activity events are
validated as domain payloads; linkage for care-task workouts uses activity_id.
"""

from __future__ import annotations

from alembic import op

revision = "20261115_0006"
down_revision = "20261115_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE care_orders DROP CONSTRAINT IF EXISTS care_order_kind_values")
    op.execute(
        """
        ALTER TABLE care_orders
        ADD CONSTRAINT care_order_kind_values
        CHECK (kind in (
            'examination', 'measurement', 'recommendation',
            'symptom_monitor', 'follow_up', 'workout'
        ))
        """
    )

    op.execute("ALTER TABLE care_order_responses ADD COLUMN IF NOT EXISTS activity_id uuid")


def downgrade() -> None:
    op.execute("ALTER TABLE care_order_responses DROP COLUMN IF EXISTS activity_id")
    op.execute("ALTER TABLE care_orders DROP CONSTRAINT IF EXISTS care_order_kind_values")
    op.execute(
        """
        ALTER TABLE care_orders
        ADD CONSTRAINT care_order_kind_values
        CHECK (kind in (
            'examination', 'measurement', 'recommendation',
            'symptom_monitor', 'follow_up'
        ))
        """
    )
