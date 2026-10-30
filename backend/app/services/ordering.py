from sqlalchemy.orm import Session

from app.core.time import utcnow


def apply_positions(db: Session, rows: list) -> None:
    """Rewrite positions as 0..n-1 inside the current transaction.

    SQLite checks UNIQUE (parent, position) immediately, so a swap cannot assign
    the other row's current position first. Move every row to a free high
    position, flush, then write the final positions.
    """
    if not rows:
        return
    start = max(row.position for row in rows) + len(rows) + 1
    now = utcnow()
    for index, row in enumerate(rows):
        row.position = start + index
        row.updated_at = now
    db.flush()
    now = utcnow()
    for index, row in enumerate(rows):
        row.position = index
        row.updated_at = now
    db.flush()
