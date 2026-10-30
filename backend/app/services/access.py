import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Course, Enrollment, Lesson, Profile, Section


def get_course(db: Session, course_id: uuid.UUID) -> Course:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def visible_course(db: Session, course_id: uuid.UUID, user: Profile | None) -> Course:
    course = get_course(db, course_id)
    if course.status == "published":
        return course
    if user is not None and user.role == "admin":
        return course
    if (
        user is not None
        and user.role == "teacher"
        and user.teacher_status == "approved"
        and course.teacher_id == user.id
    ):
        return course
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")


def get_enrollment(db: Session, student_id: uuid.UUID, course_id: uuid.UUID) -> Enrollment | None:
    return db.scalar(
        select(Enrollment).where(
            Enrollment.student_id == student_id,
            Enrollment.course_id == course_id,
        )
    )


def assert_learning_access(user: Profile, course: Course, enrollment: Enrollment | None) -> None:
    if user.role == "admin":
        return
    if (
        user.role == "teacher"
        and user.teacher_status == "approved"
        and course.teacher_id == user.id
    ):
        return
    if course.status != "published":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enroll to view this course",
        )


def owned_course(db: Session, course_id: uuid.UUID, teacher: Profile) -> Course:
    course = get_course(db, course_id)
    if course.teacher_id != teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this course")
    return course


def owned_section(db: Session, section_id: uuid.UUID, teacher: Profile) -> tuple[Section, Course]:
    section = db.get(Section, section_id)
    if section is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found")
    course = get_course(db, section.course_id)
    if course.teacher_id != teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this course")
    return section, course


def owned_lesson(db: Session, lesson_id: uuid.UUID, teacher: Profile) -> tuple[Lesson, Section, Course]:
    lesson = db.get(Lesson, lesson_id)
    if lesson is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    section, course = owned_section(db, lesson.section_id, teacher)
    return lesson, section, course


def lesson_context(db: Session, lesson_id: uuid.UUID) -> tuple[Lesson, Course]:
    lesson = db.get(Lesson, lesson_id)
    if lesson is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    section = db.get(Section, lesson.section_id)
    if section is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    course = db.get(Course, section.course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    return lesson, course
