import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.time import utcnow
from app.models import LessonProgress, Profile
from app.schemas import ProgressRead, ProgressUpdate
from app.services import mux
from app.services.access import assert_learning_access, get_enrollment, lesson_context
from app.services.mux import MuxNotConfigured
from app.services.progress import lesson_is_complete, recompute_course_completion

router = APIRouter(tags=["lessons"])


@router.get("/lessons/{lesson_id}/playback")
def playback(
    lesson_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Profile, Depends(get_current_user)],
) -> dict:
    lesson, course = lesson_context(db, lesson_id)
    enrollment = get_enrollment(db, user.id, course.id)
    assert_learning_access(user, course, enrollment)
    if lesson.type != "video":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lesson is not a video")
    try:
        return mux.sign_playback_token(playback_id=None, lesson_id=lesson.id)
    except MuxNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=exc.detail) from exc


@router.post("/lessons/{lesson_id}/progress", response_model=ProgressRead)
def save_progress(
    lesson_id: uuid.UUID,
    payload: ProgressUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Profile, Depends(get_current_user)],
) -> LessonProgress:
    lesson, course = lesson_context(db, lesson_id)
    enrollment = get_enrollment(db, user.id, course.id)
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enroll before saving progress",
        )
    row = db.scalar(
        select(LessonProgress).where(
            LessonProgress.student_id == user.id,
            LessonProgress.lesson_id == lesson.id,
        )
    )
    was_completed = bool(row.is_completed) if row is not None else False
    completed = lesson_is_complete(
        lesson,
        last_position_sec=payload.last_position_sec,
        is_completed=payload.is_completed,
        was_completed=was_completed,
    )
    if row is None:
        row = LessonProgress(
            student_id=user.id,
            lesson_id=lesson.id,
            is_completed=completed,
            last_position_sec=payload.last_position_sec,
            updated_at=utcnow(),
        )
        try:
            with db.begin_nested():
                db.add(row)
                db.flush()
        except IntegrityError:
            row = db.scalar(
                select(LessonProgress).where(
                    LessonProgress.student_id == user.id,
                    LessonProgress.lesson_id == lesson.id,
                )
            )
            if row is None:
                raise
    row.is_completed = completed
    row.last_position_sec = payload.last_position_sec
    row.updated_at = utcnow()
    db.flush()
    recompute_course_completion(db, course.id, user.id)
    return row
