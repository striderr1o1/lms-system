import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, get_optional_user
from app.models import Course, Enrollment, Lesson, LessonProgress, Profile, Section
from app.schemas import (
    CourseContent,
    CoursePublic,
    EnrollmentRead,
    LessonContent,
    Page,
    ProgressBrief,
    SectionContent,
)
from app.services.access import assert_learning_access, get_enrollment, visible_course
from app.services.progress import ordered_lessons

router = APIRouter(tags=["courses"])


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _public(course: Course, teacher_name: str | None) -> CoursePublic:
    return CoursePublic(
        id=course.id,
        teacher_id=course.teacher_id,
        teacher_name=teacher_name,
        title=course.title,
        description=course.description,
        category=course.category,
        thumbnail_url=course.thumbnail_url,
        status=course.status,
        created_at=course.created_at,
        updated_at=course.updated_at,
    )


def enrollment_read(db: Session, enrollment: Enrollment, course: Course) -> EnrollmentRead:
    lessons = ordered_lessons(db, course.id)
    lesson_ids = [lesson.id for lesson in lessons]
    done_ids: set[uuid.UUID] = set()
    if lesson_ids:
        done_ids = set(
            db.scalars(
                select(LessonProgress.lesson_id).where(
                    LessonProgress.student_id == enrollment.student_id,
                    LessonProgress.lesson_id.in_(lesson_ids),
                    LessonProgress.is_completed.is_(True),
                )
            ).all()
        )
    resume = None
    for lesson in lessons:
        if lesson.id not in done_ids:
            resume = lesson.id
            break
    if resume is None and lessons:
        resume = lessons[0].id
    return EnrollmentRead(
        id=enrollment.id,
        student_id=enrollment.student_id,
        course_id=enrollment.course_id,
        enrolled_at=enrollment.enrolled_at,
        completed_at=enrollment.completed_at,
        course_title=course.title,
        course_category=course.category,
        course_status=course.status,
        thumbnail_url=course.thumbnail_url,
        completed_lesson_count=len(done_ids),
        lesson_count=len(lessons),
        resume_lesson_id=resume,
    )


@router.get("/courses", response_model=Page)
def list_courses(
    db: Annotated[Session, Depends(get_db)],
    q: str | None = None,
    category: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=50),
) -> Page:
    filters = [Course.status == "published"]
    if category and category.strip():
        filters.append(Course.category == category.strip())
    if q and q.strip():
        pattern = _like(q.strip())
        filters.append(
            or_(
                Course.title.ilike(pattern, escape="\\"),
                Course.description.ilike(pattern, escape="\\"),
            )
        )
    total = int(db.scalar(select(func.count()).select_from(Course).where(*filters)) or 0)
    rows = db.execute(
        select(Course, Profile.full_name)
        .join(Profile, Profile.id == Course.teacher_id)
        .where(*filters)
        .order_by(Course.created_at.desc(), Course.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page(
        items=[_public(course, name) for course, name in rows],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/courses/categories")
def list_categories(db: Annotated[Session, Depends(get_db)]) -> dict[str, list[str]]:
    rows = db.scalars(
        select(Course.category)
        .where(
            Course.status == "published",
            Course.category.is_not(None),
            Course.category != "",
        )
        .distinct()
        .order_by(Course.category)
    ).all()
    return {"categories": [row for row in rows if row]}


@router.get("/courses/{course_id}", response_model=CoursePublic)
def get_course_detail(
    course_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Profile | None, Depends(get_optional_user)],
) -> CoursePublic:
    course = visible_course(db, course_id, user)
    teacher = db.get(Profile, course.teacher_id)
    return _public(course, teacher.full_name if teacher else None)


@router.post("/courses/{course_id}/enroll", response_model=EnrollmentRead)
def enroll(
    course_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Profile, Depends(get_current_user)],
) -> EnrollmentRead:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if course.status != "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only published courses can be enrolled",
        )
    existing = get_enrollment(db, user.id, course.id)
    if existing is None:
        existing = Enrollment(student_id=user.id, course_id=course.id)
        db.add(existing)
        db.flush()
    return enrollment_read(db, existing, course)


@router.get("/courses/{course_id}/content", response_model=CourseContent)
def course_content(
    course_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Profile, Depends(get_current_user)],
) -> CourseContent:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    enrollment = get_enrollment(db, user.id, course.id)
    assert_learning_access(user, course, enrollment)
    sections = list(
        db.scalars(
            select(Section).where(Section.course_id == course.id).order_by(Section.position)
        ).all()
    )
    section_ids = [section.id for section in sections]
    lessons = (
        list(
            db.scalars(
                select(Lesson)
                .where(Lesson.section_id.in_(section_ids))
                .order_by(Lesson.position)
            ).all()
        )
        if section_ids
        else []
    )
    progress_by_lesson: dict[uuid.UUID, LessonProgress] = {}
    if enrollment is not None and lessons:
        progress_rows = db.scalars(
            select(LessonProgress).where(
                LessonProgress.student_id == user.id,
                LessonProgress.lesson_id.in_([lesson.id for lesson in lessons]),
            )
        ).all()
        progress_by_lesson = {row.lesson_id: row for row in progress_rows}
    grouped: dict[uuid.UUID, list[LessonContent]] = {section.id: [] for section in sections}
    for lesson in lessons:
        progress = progress_by_lesson.get(lesson.id)
        grouped[lesson.section_id].append(
            LessonContent(
                id=lesson.id,
                title=lesson.title,
                type=lesson.type,
                position=lesson.position,
                body_markdown=lesson.body_markdown,
                external_url=lesson.external_url,
                file_url=lesson.file_url,
                duration_sec=lesson.duration_sec,
                progress=(
                    ProgressBrief(
                        is_completed=progress.is_completed,
                        last_position_sec=progress.last_position_sec,
                    )
                    if progress is not None
                    else None
                ),
            )
        )
    return CourseContent(
        course_id=course.id,
        title=course.title,
        status=course.status,
        sections=[
            SectionContent(
                id=section.id,
                title=section.title,
                position=section.position,
                lessons=grouped.get(section.id, []),
            )
            for section in sections
        ],
    )
