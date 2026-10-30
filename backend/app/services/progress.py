import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import Enrollment, Lesson, LessonProgress, Section


def lesson_is_complete(
    lesson: Lesson,
    *,
    last_position_sec: int,
    is_completed: bool | None,
    was_completed: bool,
) -> bool:
    if lesson.type in {"text", "link", "file"}:
        if is_completed is True:
            return True
        if is_completed is False:
            return False
        return was_completed

    duration = lesson.duration_sec
    watched_enough = (
        duration is not None and duration > 0 and last_position_sec >= duration * 0.9
    )
    if is_completed is True or watched_enough:
        return True
    if is_completed is False and not watched_enough:
        return False
    return was_completed


def ordered_lessons(db: Session, course_id: uuid.UUID) -> list[Lesson]:
    return list(
        db.scalars(
            select(Lesson)
            .join(Section, Lesson.section_id == Section.id)
            .where(Section.course_id == course_id)
            .order_by(Section.position, Lesson.position)
        ).all()
    )


def completed_lesson_count(db: Session, student_id: uuid.UUID, lesson_ids: list[uuid.UUID]) -> int:
    if not lesson_ids:
        return 0
    return int(
        db.scalar(
            select(func.count())
            .select_from(LessonProgress)
            .where(
                LessonProgress.student_id == student_id,
                LessonProgress.lesson_id.in_(lesson_ids),
                LessonProgress.is_completed.is_(True),
            )
        )
        or 0
    )


def recompute_course_completion(
    db: Session,
    course_id: uuid.UUID,
    student_id: uuid.UUID | None = None,
) -> None:
    lesson_ids = list(
        db.scalars(
            select(Lesson.id)
            .join(Section, Lesson.section_id == Section.id)
            .where(Section.course_id == course_id)
        ).all()
    )
    stmt = select(Enrollment).where(Enrollment.course_id == course_id)
    if student_id is not None:
        stmt = stmt.where(Enrollment.student_id == student_id)
    for enrollment in db.scalars(stmt).all():
        if not lesson_ids:
            enrollment.completed_at = None
            continue
        done = db.scalar(
            select(func.count())
            .select_from(LessonProgress)
            .where(
                LessonProgress.student_id == enrollment.student_id,
                LessonProgress.lesson_id.in_(lesson_ids),
                LessonProgress.is_completed.is_(True),
            )
        ) or 0
        if done == len(lesson_ids):
            if enrollment.completed_at is None:
                enrollment.completed_at = utcnow()
        else:
            enrollment.completed_at = None
