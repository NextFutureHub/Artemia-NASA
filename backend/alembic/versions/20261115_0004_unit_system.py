"""Add unit_system preference on profiles.

Revision ID: 20261115_0004
Revises: 20261115_0003
Create Date: 2026-11-15
"""

from __future__ import annotations

from alembic import op

revision = "20261115_0004"
down_revision = "20261115_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS unit_system text NOT NULL DEFAULT 'metric'
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'unit_system_values'
          ) THEN
            ALTER TABLE profiles
            ADD CONSTRAINT unit_system_values CHECK (unit_system in ('metric', 'us'));
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE profiles DROP CONSTRAINT IF EXISTS unit_system_values")
    op.execute("ALTER TABLE profiles DROP COLUMN IF EXISTS unit_system")
