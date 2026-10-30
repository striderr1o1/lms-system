import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.deps import get_db, get_optional_user
from app.main import app
from app.models import Base, Profile


@pytest.fixture
def engine():
    test_engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(test_engine, "connect")
    def _enable_foreign_keys(dbapi_conn, _record) -> None:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(test_engine)
    yield test_engine
    test_engine.dispose()


@pytest.fixture
def db(engine) -> Session:
    factory = sessionmaker(bind=engine, autoflush=True, autocommit=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db: Session):
    def override_db():
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def act_as(db: Session):
    def _act(user: Profile) -> None:
        user_id = user.id

        def _override() -> Profile:
            row = db.get(Profile, user_id)
            if row is None:
                raise HTTPException(status_code=401, detail="Profile not found")
            db.refresh(row)
            if not row.is_active:
                raise HTTPException(status_code=403, detail="Account is inactive")
            return row

        app.dependency_overrides[get_optional_user] = _override

    return _act


def make_user(
    db: Session,
    *,
    role: str = "student",
    teacher_status: str | None = None,
    full_name: str = "Ada Lovelace",
    email: str | None = None,
    is_active: bool = True,
) -> Profile:
    if role == "teacher" and teacher_status is None:
        teacher_status = "approved"
    if role != "teacher":
        teacher_status = None
    user = Profile(
        id=uuid.uuid4(),
        full_name=full_name,
        email=email or f"{uuid.uuid4()}@example.com",
        role=role,
        teacher_status=teacher_status,
        is_active=is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
