import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import require_admin
from app.core.time import utcnow
from app.models import Course, Enrollment, Profile
from app.schemas import (
    AdminCourseRead,
    AdminUserUpdate,
    CourseStatusUpdate,
    Page,
    ProfileRead,
)
from app.services.access import get_course
from app.services.analytics import course_analytics, engagement, overview

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("/users", response_model=Page)
def list_users(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[Profile, Depends(require_admin)],
    role: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
) -> Page:
    filters = []
    if role and role.strip():
        if role not in {"student", "teacher", "admin"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid role")
        filters.append(Profile.role == role)
    if q and q.strip():
        pattern = _like(q.strip())
        filters.append(
            or_(
                Profile.full_name.ilike(pattern, escape="\\"),
                Profile.email.ilike(pattern, escape="\\"),
            )
        )
    count_stmt = select(func.count()).select_from(Profile)
    list_stmt = select(Profile).order_by(Profile.created_at.desc(), Profile.id)
    if filters:
        count_stmt = count_stmt.where(*filters)
        list_stmt = list_stmt.where(*filters)
    total = int(db.scalar(count_stmt) or 0)
    rows = db.scalars(list_stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return Page(
        items=[ProfileRead.model_validate(row) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.patch("/users/{user_id}", response_model=ProfileRead)
def update_user(
    user_id: uuid.UUID,
    payload: AdminUserUpdate,
    db: Annotated[Session, Depends(get_db)],
    actor: Annotated[Profile, Depends(require_admin)],
) -> Profile:
    user = db.get(Profile, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    fields = payload.model_fields_set
    new_role = payload.role if "role" in fields and payload.role is not None else user.role
    new_active = (
        payload.is_active if "is_active" in fields and payload.is_active is not None else user.is_active
    )
    new_status = payload.teacher_status if "teacher_status" in fields else user.teacher_status
    if new_role == "teacher":
        if new_status is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Teachers require teacher_status",
            )
    else:
        if "teacher_status" in fields and payload.teacher_status is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="teacher_status must be empty unless role is teacher",
            )
        new_status = None
    if user.id == actor.id and new_active is False:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot deactivate your own account",
        )
    if user.role == "admin" and new_role != "admin":
        others = int(
            db.scalar(
                select(func.count())
                .select_from(Profile)
                .where(Profile.role == "admin", Profile.id != user.id)
            )
            or 0
        )
        if others == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot demote the last admin",
            )
    user.role = new_role
    user.teacher_status = new_status
    user.is_active = new_active
    db.flush()
    return user


@router.get("/courses", response_model=Page)
def list_courses(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[Profile, Depends(require_admin)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
) -> Page:
    total = int(db.scalar(select(func.count()).select_from(Course)) or 0)
    rows = db.execute(
        select(Course, Profile.full_name)
        .join(Profile, Profile.id == Course.teacher_id)
        .order_by(Course.updated_at.desc(), Course.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    course_ids = [course.id for course, _name in rows]
    counts: dict = {}
    if course_ids:
        counts = {
            course_id: int(count)
            for course_id, count in db.execute(
                select(Enrollment.course_id, func.count())
                .where(Enrollment.course_id.in_(course_ids))
                .group_by(Enrollment.course_id)
            ).all()
        }
    items = [
        AdminCourseRead(
            id=course.id,
            teacher_id=course.teacher_id,
            teacher_name=name,
            title=course.title,
            description=course.description,
            category=course.category,
            thumbnail_url=course.thumbnail_url,
            status=course.status,
            created_at=course.created_at,
            updated_at=course.updated_at,
            enrollment_count=counts.get(course.id, 0),
        )
        for course, name in rows
    ]
    return Page(items=items, page=page, page_size=page_size, total=total)


@router.patch("/courses/{course_id}/status", response_model=AdminCourseRead)
def update_course_status(
    course_id: uuid.UUID,
    payload: CourseStatusUpdate,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[Profile, Depends(require_admin)],
) -> AdminCourseRead:
    course = get_course(db, course_id)
    course.status = payload.status
    course.updated_at = utcnow()
    db.flush()
    teacher = db.get(Profile, course.teacher_id)
    enrollment_count = int(
        db.scalar(
            select(func.count()).select_from(Enrollment).where(Enrollment.course_id == course.id)
        )
        or 0
    )
    return AdminCourseRead(
        id=course.id,
        teacher_id=course.teacher_id,
        teacher_name=teacher.full_name if teacher else None,
        title=course.title,
        description=course.description,
        category=course.category,
        thumbnail_url=course.thumbnail_url,
        status=course.status,
        created_at=course.created_at,
        updated_at=course.updated_at,
        enrollment_count=enrollment_count,
    )


@router.get("/analytics/overview")
def analytics_overview(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[Profile, Depends(require_admin)],
):
    return overview(db)


@router.get("/analytics/courses")
def analytics_courses(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[Profile, Depends(require_admin)],
):
    return course_analytics(db)


@router.get("/analytics/engagement")
def analytics_engagement(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[Profile, Depends(require_admin)],
):
    return engagement(db)
