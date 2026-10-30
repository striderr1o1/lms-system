from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

_engine: Engine | None = None
_sessionmaker: sessionmaker[Session] | None = None


def make_engine(url: str) -> Engine:
    connect_args: dict = {}
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        from sqlalchemy.pool import StaticPool

        kwargs["poolclass"] = StaticPool
        kwargs["pool_pre_ping"] = False
    engine = create_engine(url, connect_args=connect_args, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _sqlite_foreign_keys(dbapi_conn, _record) -> None:
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def get_sessionmaker() -> sessionmaker[Session]:
    global _engine, _sessionmaker
    if _sessionmaker is None:
        if not settings.database_url:
            raise RuntimeError(
                "DATABASE_URL is not set. Copy the session-mode URI from Supabase "
                "into backend/.env. See README.md."
            )
        _engine = make_engine(settings.database_url)
        _sessionmaker = sessionmaker(
            bind=_engine,
            autoflush=True,
            autocommit=False,
            expire_on_commit=False,
        )
    return _sessionmaker


def get_db():
    db = get_sessionmaker()()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
