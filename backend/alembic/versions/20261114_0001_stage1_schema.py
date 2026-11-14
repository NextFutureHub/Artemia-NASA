"""Section 17.2 tables and reference catalogs. Receipts live in the private schema."""

from alembic import op

revision = "20261114_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS private")
    from app.db import Base
    from app import models  # noqa: F401
    from app.reference import insert_reference

    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)
    insert_reference(bind)


def downgrade() -> None:
    from app.db import Base
    from app import models  # noqa: F401

    Base.metadata.drop_all(bind=op.get_bind())
    op.execute("DROP SCHEMA IF EXISTS private CASCADE")
