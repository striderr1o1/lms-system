import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models import Course, Enrollment, Lesson, LessonProgress, Profile, Section
from app.routers.courses import enrollment_read
from app.schemas import EnrollmentRead, ProfileRead, ProfileUpdate, ProgressRead

router = APIRouter(tags=["me"])


@router.get("/me", response_model=ProfileRead)
def read_me(user: Annotated[Profile, Depends(get_current_user)]) -> Profile:
    return user


@router.patch("/me", response_model=ProfileRead)
def update_me(
    payload: ProfileUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Profile, Depends(get_current_user)],
) -> Profile:
    user.full_name = payload.full_name
    db.add(user)
    db.flush()
    return user


@router.post("/me/teacher-application", response_model=ProfileRead)
def apply_teacher(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Profile, Depends(get_current_user)],
) -> Profile:
    if user.role != "student":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a student can apply to teach",
        )
    user.role = "teacher"
    user.teacher_status = "pending"
    db.add(user)
    db.flush()
    return user


@router.get("/me/enrollments", response_model=list[EnrollmentRead])
def my_enrollments(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Profile, Depends(get_current_user)],
) -> list[EnrollmentRead]:
    rows = db.execute(
        select(Enrollment, Course)
        .join(Course, Course.id == Enrollment.course_id)
        .where(Enrollment.student_id == user.id)
        .order_by(Enrollment.enrolled_at.desc())
    ).all()
    return [enrollment_read(db, enrollment, course) for enrollment, course in rows]


@router.get("/me/progress", response_model=list[ProgressRead])
def my_progress(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Profile, Depends(get_current_user)],
    course_id: uuid.UUID | None = None,
) -> list[LessonProgress]:
    stmt = select(LessonProgress).where(LessonProgress.student_id == user.id)
    if course_id is not None:
        course = db.get(Course, course_id)
        if course is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
        lesson_ids = select(Lesson.id).join(Section, Lesson.section_id == Section.id).where(
            Section.course_id == course_id
        )
        stmt = stmt.where(LessonProgress.lesson_id.in_(lesson_ids))
    stmt = stmt.order_by(LessonProgress.updated_at.desc())
    return list(db.scalars(stmt).all())
