"""Read the caller's own change log. The payload is an identifier, never a medical body."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ContractError
from app.models import ChangeLog


def pull_updates(session: Session, actor_id: str, cursor: str | None, limit: int) -> dict[str, object]:
    if limit < 1 or limit > 100:
        raise ContractError("validation_error", "limit")
    position = 0
    if cursor not in (None, ""):
        if cursor is None or not cursor.isdigit():
            raise ContractError("validation_error", "cursor")
        position = int(cursor)
    rows = session.scalars(
        select(ChangeLog)
        .where(ChangeLog.scope == actor_id, ChangeLog.position > position)
        .order_by(ChangeLog.position)
        .limit(limit)
    ).all()
    next_cursor = cursor or "0"
    if rows:
        next_cursor = str(rows[-1].position)
    return {
        "events": [
            {
                "position": row.position,
                "entity_type": row.entity_type,
                "entity_id": str(row.entity_id),
                "occurred_at": row.occurred_at.isoformat(),
            }
            for row in rows
        ],
        "next_cursor": next_cursor,
    }
