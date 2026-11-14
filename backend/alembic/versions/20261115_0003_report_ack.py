"""Allow report_ack operations for device_received and patient_read."""

from alembic import op

revision = "20261115_0003"
down_revision = "20261115_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE private.sync_receipts DROP CONSTRAINT IF EXISTS operation_type_values")
    op.execute(
        """
        ALTER TABLE private.sync_receipts
        ADD CONSTRAINT operation_type_values CHECK (
            operation_type in (
                'checkin_bundle', 'measurement', 'report_bundle', 'invalidation',
                'profile_preferences', 'consent_change', 'care_order_response', 'report_ack'
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
                'profile_preferences', 'consent_change', 'care_order_response'
            )
        )
        """
    )
