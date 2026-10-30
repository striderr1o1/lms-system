import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import Course, Enrollment, Lesson, LessonProgress, Profile, Section
from app.schemas import (
    CourseAnalytics,
    DayCount,
    EngagementAnalytics,
    EngagementCourse,
    EngagementLesson,
    OverviewAnalytics,
    TeacherLeaderboardRow,
    TopCourse,
)

WINDOW_DAYS = 30


def _as_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _day_key(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).date().isoformat()


def _bucket(values: list[datetime], cutoff: datetime) -> list[DayCount]:
    counts: dict[str, int] = {}
    for value in values:
        moment = _as_datetime(value)
        if moment is None or moment < cutoff:
            continue
        key = _day_key(moment)
        counts[key] = counts.get(key, 0) + 1
    return [DayCount(day=day, count=count) for day, count in sorted(counts.items())]


def overview(db: Session) -> OverviewAnalytics:
    cutoff = utcnow() - timedelta(days=WINDOW_DAYS)
    totals = {"student": 0, "teacher": 0, "admin": 0}
    for role, count in db.execute(select(Profile.role, func.count()).group_by(Profile.role)).all():
        if role in totals:
            totals[role] = int(count)

    signup_times = list(db.scalars(select(Profile.created_at)).all())
    enroll_times = list(db.scalars(select(Enrollment.enrolled_at)).all())

    learners: dict[str, set[uuid.UUID]] = {}
    for student_id, updated_at in db.execute(
        select(LessonProgress.student_id, LessonProgress.updated_at)
    ).all():
        moment = _as_datetime(updated_at)
        if moment is None or moment < cutoff:
            continue
        learners.setdefault(_day_key(moment), set()).add(student_id)

    courses_by_status = {"draft": 0, "published": 0, "archived": 0}
    for status, count in db.execute(select(Course.status, func.count()).group_by(Course.status)).all():
        if status in courses_by_status:
            courses_by_status[status] = int(count)

    return OverviewAnalytics(
        totals_by_role=totals,
        signups_by_day=_bucket(signup_times, cutoff),
        courses_by_status=courses_by_status,
        enrollments_by_day=_bucket(enroll_times, cutoff),
        active_learners_by_day=[
            DayCount(day=day, count=len(students)) for day, students in sorted(learners.items())
        ],
        window_days=WINDOW_DAYS,
    )


def course_analytics(db: Session) -> CourseAnalytics:
    courses = list(db.scalars(select(Course)).all())
    enrollments = list(db.scalars(select(Enrollment)).all())
    by_course: dict[uuid.UUID, list[Enrollment]] = {}
    for enrollment in enrollments:
        by_course.setdefault(enrollment.course_id, []).append(enrollment)

    top: list[TopCourse] = []
    for course in courses:
        rows = by_course.get(course.id, [])
        completed = sum(1 for row in rows if row.completed_at is not None)
        rate = (completed / len(rows)) if rows else 0.0
        top.append(
            TopCourse(
                course_id=course.id,
                title=course.title,
                status=course.status,
                teacher_id=course.teacher_id,
                enrollment_count=len(rows),
                completion_rate=rate,
            )
        )
    top.sort(key=lambda item: (-item.enrollment_count, item.title))

    teacher_ids = {course.teacher_id for course in courses}
    teachers = {
        profile.id: profile
        for profile in db.scalars(select(Profile).where(Profile.id.in_(teacher_ids))).all()
    } if teacher_ids else {}
    course_teacher = {course.id: course.teacher_id for course in courses}
    buckets: dict[uuid.UUID, dict] = {}
    for course in courses:
        bucket = buckets.setdefault(
            course.teacher_id,
            {"courses": 0, "students": set(), "enrollments": 0, "completed": 0},
        )
        bucket["courses"] += 1
    for enrollment in enrollments:
        teacher_id = course_teacher.get(enrollment.course_id)
        if teacher_id is None:
            continue
        bucket = buckets.setdefault(
            teacher_id,
            {"courses": 0, "students": set(), "enrollments": 0, "completed": 0},
        )
        bucket["students"].add(enrollment.student_id)
        bucket["enrollments"] += 1
        if enrollment.completed_at is not None:
            bucket["completed"] += 1

    leaderboard: list[TeacherLeaderboardRow] = []
    for teacher_id, bucket in buckets.items():
        teacher = teachers.get(teacher_id)
        total = bucket["enrollments"]
        leaderboard.append(
            TeacherLeaderboardRow(
                teacher_id=teacher_id,
                full_name=teacher.full_name if teacher else None,
                email=teacher.email if teacher else None,
                course_count=bucket["courses"],
                student_count=len(bucket["students"]),
                completion_rate=(bucket["completed"] / total) if total else 0.0,
            )
        )
    leaderboard.sort(key=lambda row: (-row.student_count, -row.course_count, row.full_name or ""))
    return CourseAnalytics(top_courses=top[:20], teacher_leaderboard=leaderboard)


def engagement(db: Session) -> EngagementAnalytics:
    rows = db.execute(
        select(Lesson, Section, Course)
        .join(Section, Lesson.section_id == Section.id)
        .join(Course, Section.course_id == Course.id)
        .where(Course.status == "published")
        .order_by(Course.title, Section.position, Lesson.position)
    ).all()
    completed = {
        lesson_id: int(count)
        for lesson_id, count in db.execute(
            select(LessonProgress.lesson_id, func.count())
            .where(LessonProgress.is_completed.is_(True))
            .group_by(LessonProgress.lesson_id)
        ).all()
    }
    grouped: dict[uuid.UUID, EngagementCourse] = {}
    for lesson, section, course in rows:
        item = grouped.get(course.id)
        if item is None:
            item = EngagementCourse(course_id=course.id, title=course.title, lessons=[])
            grouped[course.id] = item
        item.lessons.append(
            EngagementLesson(
                lesson_id=lesson.id,
                title=lesson.title,
                section_title=section.title,
                section_position=section.position,
                lesson_position=lesson.position,
                completed_count=completed.get(lesson.id, 0),
            )
        )
    published_without_lessons = db.scalars(
        select(Course).where(Course.status == "published").order_by(Course.title)
    ).all()
    for course in published_without_lessons:
        grouped.setdefault(
            course.id,
            EngagementCourse(course_id=course.id, title=course.title, lessons=[]),
        )
    courses = sorted(grouped.values(), key=lambda course: course.title)
    return EngagementAnalytics(courses=courses)
