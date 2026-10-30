import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import require_approved_teacher
from app.core.time import utcnow
from app.models import Course, Enrollment, Lesson, Profile, Section
from app.schemas import (
    CourseCreate,
    CoursePublic,
    CourseStudentRead,
    CourseUpdate,
    LessonCreate,
    LessonRead,
    LessonUpdate,
    ReorderBody,
    SectionCreate,
    SectionRead,
    SectionUpdate,
    normalize_lesson_fields,
)
from app.services import mux
from app.services.access import owned_course, owned_lesson, owned_section
from app.services.mux import MuxNotConfigured
from app.services.ordering import apply_positions
from app.services.progress import completed_lesson_count, ordered_lessons, recompute_course_completion

router = APIRouter(
    prefix="/teacher",
    tags=["teacher"],
    dependencies=[Depends(require_approved_teacher)],
)


def _bad_lesson(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


def _course_public(course: Course, teacher: Profile) -> CoursePublic:
    return CoursePublic(
        id=course.id,
        teacher_id=course.teacher_id,
        teacher_name=teacher.full_name,
        title=course.title,
        description=course.description,
        category=course.category,
        thumbnail_url=course.thumbnail_url,
        status=course.status,
        created_at=course.created_at,
        updated_at=course.updated_at,
    )


def _apply_lesson(lesson: Lesson, payload: LessonCreate | LessonUpdate, *, creating: bool) -> None:
    if creating:
        data = payload
        assert isinstance(data, LessonCreate)
        type_ = data.type
        title = data.title
        body = data.body_markdown
        external = data.external_url
        file_url = data.file_url
        duration = data.duration_sec
    else:
        data = payload
        assert isinstance(data, LessonUpdate)
        fields = data.model_fields_set
        type_ = data.type if "type" in fields and data.type is not None else lesson.type
        title = data.title if "title" in fields else lesson.title
        body = data.body_markdown if "body_markdown" in fields else lesson.body_markdown
        external = data.external_url if "external_url" in fields else lesson.external_url
        file_url = data.file_url if "file_url" in fields else lesson.file_url
        duration = data.duration_sec if "duration_sec" in fields else lesson.duration_sec
    try:
        title, body, external, file_url, duration = normalize_lesson_fields(
            type_=type_,
            title=title,
            body_markdown=body,
            external_url=external,
            file_url=file_url,
            duration_sec=duration,
        )
    except ValueError as exc:
        raise _bad_lesson(exc) from exc
    lesson.title = title
    lesson.type = type_
    lesson.body_markdown = body
    lesson.external_url = external
    lesson.file_url = file_url
    lesson.duration_sec = duration
    lesson.updated_at = utcnow()


def _reorder(rows: list, ordered_ids: list[uuid.UUID], db: Session) -> None:
    if len(ordered_ids) != len(set(ordered_ids)) or set(ordered_ids) != {row.id for row in rows}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ordered_ids must list each item once",
        )
    by_id = {row.id: row for row in rows}
    apply_positions(db, [by_id[item_id] for item_id in ordered_ids])


@router.get("/courses", response_model=list[CoursePublic])
def list_my_courses(
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> list[CoursePublic]:
    courses = db.scalars(
        select(Course).where(Course.teacher_id == teacher.id).order_by(Course.updated_at.desc())
    ).all()
    return [_course_public(course, teacher) for course in courses]


@router.post("/courses", response_model=CoursePublic, status_code=status.HTTP_201_CREATED)
def create_course(
    payload: CourseCreate,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> CoursePublic:
    course = Course(
        teacher_id=teacher.id,
        title=payload.title,
        description=payload.description,
        category=payload.category,
        thumbnail_url=payload.thumbnail_url,
        status="draft",
    )
    db.add(course)
    db.flush()
    return _course_public(course, teacher)


@router.patch("/courses/{course_id}", response_model=CoursePublic)
def update_course(
    course_id: uuid.UUID,
    payload: CourseUpdate,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> CoursePublic:
    course = owned_course(db, course_id, teacher)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(course, key, value)
    course.updated_at = utcnow()
    db.flush()
    return _course_public(course, teacher)


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    course_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> Response:
    course = owned_course(db, course_id, teacher)
    db.delete(course)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/courses/{course_id}/sections",
    response_model=SectionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_section(
    course_id: uuid.UUID,
    payload: SectionCreate,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> Section:
    course = owned_course(db, course_id, teacher)
    current = db.scalar(select(func.max(Section.position)).where(Section.course_id == course.id))
    section = Section(
        course_id=course.id,
        title=payload.title,
        position=0 if current is None else int(current) + 1,
    )
    db.add(section)
    db.flush()
    return section


@router.patch("/sections/{section_id}", response_model=SectionRead)
def update_section(
    section_id: uuid.UUID,
    payload: SectionUpdate,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> Section:
    section, _course = owned_section(db, section_id, teacher)
    section.title = payload.title
    section.updated_at = utcnow()
    db.flush()
    return section


@router.delete("/sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section(
    section_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> Response:
    section, course = owned_section(db, section_id, teacher)
    db.delete(section)
    db.flush()
    recompute_course_completion(db, course.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/courses/{course_id}/sections/reorder", response_model=list[SectionRead])
def reorder_sections(
    course_id: uuid.UUID,
    payload: ReorderBody,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> list[Section]:
    course = owned_course(db, course_id, teacher)
    rows = list(
        db.scalars(select(Section).where(Section.course_id == course.id).order_by(Section.position)).all()
    )
    _reorder(rows, payload.ordered_ids, db)
    return list(
        db.scalars(select(Section).where(Section.course_id == course.id).order_by(Section.position)).all()
    )


@router.post(
    "/sections/{section_id}/lessons",
    response_model=LessonRead,
    status_code=status.HTTP_201_CREATED,
)
def create_lesson(
    section_id: uuid.UUID,
    payload: LessonCreate,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> Lesson:
    section, course = owned_section(db, section_id, teacher)
    current = db.scalar(select(func.max(Lesson.position)).where(Lesson.section_id == section.id))
    lesson = Lesson(
        section_id=section.id,
        title=payload.title.strip() or payload.title,
        type=payload.type,
        position=0 if current is None else int(current) + 1,
    )
    _apply_lesson(lesson, payload, creating=True)
    db.add(lesson)
    db.flush()
    recompute_course_completion(db, course.id)
    return lesson


@router.patch("/lessons/{lesson_id}", response_model=LessonRead)
def update_lesson(
    lesson_id: uuid.UUID,
    payload: LessonUpdate,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> Lesson:
    lesson, _section, _course = owned_lesson(db, lesson_id, teacher)
    _apply_lesson(lesson, payload, creating=False)
    db.flush()
    return lesson


@router.delete("/lessons/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lesson(
    lesson_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> Response:
    lesson, _section, course = owned_lesson(db, lesson_id, teacher)
    db.delete(lesson)
    db.flush()
    recompute_course_completion(db, course.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sections/{section_id}/lessons/reorder", response_model=list[LessonRead])
def reorder_lessons(
    section_id: uuid.UUID,
    payload: ReorderBody,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> list[Lesson]:
    section, _course = owned_section(db, section_id, teacher)
    rows = list(
        db.scalars(select(Lesson).where(Lesson.section_id == section.id).order_by(Lesson.position)).all()
    )
    _reorder(rows, payload.ordered_ids, db)
    return list(
        db.scalars(select(Lesson).where(Lesson.section_id == section.id).order_by(Lesson.position)).all()
    )


@router.post("/lessons/{lesson_id}/video-upload")
def video_upload(
    lesson_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> dict:
    lesson, _section, _course = owned_lesson(db, lesson_id, teacher)
    if lesson.type != "video":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lesson is not a video")
    try:
        return mux.create_direct_upload(
            lesson_id=lesson.id,
            cors_origin=settings.frontend_origin,
        )
    except MuxNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=exc.detail) from exc


@router.get("/courses/{course_id}/students", response_model=list[CourseStudentRead])
def course_students(
    course_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher: Annotated[Profile, Depends(require_approved_teacher)],
) -> list[CourseStudentRead]:
    course = owned_course(db, course_id, teacher)
    lessons = ordered_lessons(db, course.id)
    lesson_ids = [lesson.id for lesson in lessons]
    rows = db.execute(
        select(Enrollment, Profile)
        .join(Profile, Profile.id == Enrollment.student_id)
        .where(Enrollment.course_id == course.id)
        .order_by(Enrollment.enrolled_at)
    ).all()
    result: list[CourseStudentRead] = []
    for enrollment, student in rows:
        result.append(
            CourseStudentRead(
                student_id=student.id,
                name=student.full_name,
                email=student.email,
                enrolled_at=enrollment.enrolled_at,
                completed_at=enrollment.completed_at,
                completed_lesson_count=completed_lesson_count(db, student.id, lesson_ids),
            )
        )
    return result
