from sqlalchemy import func, select

from app.models import Course, Enrollment, Lesson, Section, WebhookEvent
from tests.conftest import make_user

MUX_DETAIL = "Mux is not configured yet. Follow docs/MUX.md."


def make_course(
    db,
    teacher,
    *,
    title="Visible course",
    status="published",
    lesson_type="text",
    lesson_title="Read this",
    body="Hello from the lesson.",
):
    course = Course(
        teacher_id=teacher.id,
        title=title,
        description="A published description",
        category="Design",
        status=status,
    )
    db.add(course)
    db.flush()
    section = Section(course_id=course.id, title="Start", position=0)
    db.add(section)
    db.flush()
    lesson = Lesson(
        section_id=section.id,
        title=lesson_title,
        type=lesson_type,
        position=0,
        body_markdown=body if lesson_type == "text" else None,
        external_url="https://example.com/resource" if lesson_type == "link" else None,
        file_url="https://example.com/file.pdf" if lesson_type == "file" else None,
    )
    db.add(lesson)
    db.commit()
    db.refresh(course)
    db.refresh(section)
    db.refresh(lesson)
    return course, section, lesson


def test_health(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_missing_token_is_401(client):
    response = client.get("/api/v1/me")
    assert response.status_code == 401


def test_catalog_hides_drafts(client, db):
    teacher = make_user(db, role="teacher", full_name="Teacher")
    draft, _section, _lesson = make_course(db, teacher, title="Hidden draft", status="draft")
    published, _section, _lesson = make_course(db, teacher, title="Visible course", status="published")

    listing = client.get("/api/v1/courses")
    assert listing.status_code == 200
    titles = [item["title"] for item in listing.json()["items"]]
    assert "Visible course" in titles
    assert "Hidden draft" not in titles

    assert client.get(f"/api/v1/courses/{draft.id}").status_code == 404
    visible = client.get(f"/api/v1/courses/{published.id}")
    assert visible.status_code == 200
    assert visible.json()["title"] == "Visible course"


def test_enroll_content_and_idempotent_enroll(client, db, act_as):
    teacher = make_user(db, role="teacher")
    course, _section, lesson = make_course(db, teacher)
    student = make_user(db, role="student", full_name="Student")
    act_as(student)

    first = client.post(f"/api/v1/courses/{course.id}/enroll")
    assert first.status_code == 200
    second = client.post(f"/api/v1/courses/{course.id}/enroll")
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert db.scalar(select(func.count()).select_from(Enrollment)) == 1

    content = client.get(f"/api/v1/courses/{course.id}/content")
    assert content.status_code == 200
    body = content.json()
    assert body["sections"][0]["lessons"][0]["id"] == str(lesson.id)
    assert body["sections"][0]["lessons"][0]["title"] == "Read this"


def test_unenrolled_student_cannot_read_content_or_progress(client, db, act_as):
    teacher = make_user(db, role="teacher")
    course, _section, lesson = make_course(db, teacher)
    outsider = make_user(db, role="student", full_name="Outsider")
    act_as(outsider)

    assert client.get(f"/api/v1/courses/{course.id}/content").status_code == 403
    progress = client.post(
        f"/api/v1/lessons/{lesson.id}/progress",
        json={"last_position_sec": 1, "is_completed": True},
    )
    assert progress.status_code == 403


def test_text_completion_sets_and_clears_completed_at(client, db, act_as):
    teacher = make_user(db, role="teacher", full_name="Teacher")
    course, section, lesson = make_course(db, teacher)
    student = make_user(db, role="student", full_name="Student")
    act_as(student)
    assert client.post(f"/api/v1/courses/{course.id}/enroll").status_code == 200

    saved = client.post(
        f"/api/v1/lessons/{lesson.id}/progress",
        json={"last_position_sec": 0, "is_completed": True},
    )
    assert saved.status_code == 200
    assert saved.json()["is_completed"] is True

    enrollments = client.get("/api/v1/me/enrollments")
    assert enrollments.status_code == 200
    assert enrollments.json()[0]["completed_at"] is not None

    act_as(teacher)
    created = client.post(
        f"/api/v1/teacher/sections/{section.id}/lessons",
        json={"title": "Second lesson", "type": "text", "body_markdown": "More reading."},
    )
    assert created.status_code == 201

    act_as(student)
    again = client.get("/api/v1/me/enrollments")
    assert again.status_code == 200
    assert again.json()[0]["completed_at"] is None


def test_pending_teacher_cannot_create_approved_teacher_cannot_edit_others(client, db, act_as):
    student = make_user(db, role="student", full_name="Future teacher")
    admin = make_user(db, role="admin", full_name="Admin")
    other = make_user(db, role="teacher", full_name="Other teacher")

    act_as(student)
    applied = client.post("/api/v1/me/teacher-application")
    assert applied.status_code == 200
    assert applied.json()["role"] == "teacher"
    assert applied.json()["teacher_status"] == "pending"
    blocked = client.post("/api/v1/teacher/courses", json={"title": "Not yet"})
    assert blocked.status_code == 403

    act_as(admin)
    approved = client.patch(
        f"/api/v1/admin/users/{student.id}",
        json={"teacher_status": "approved"},
    )
    assert approved.status_code == 200
    assert approved.json()["role"] == "teacher"
    assert approved.json()["teacher_status"] == "approved"

    denied = client.patch(
        f"/api/v1/admin/users/{admin.id}",
        json={"is_active": False},
    )
    assert denied.status_code == 409
    db.refresh(admin)
    assert admin.is_active is True

    act_as(student)
    created = client.post("/api/v1/teacher/courses", json={"title": "My course"})
    assert created.status_code == 201
    course_id = created.json()["id"]

    act_as(other)
    stolen = client.patch(f"/api/v1/teacher/courses/{course_id}", json={"title": "Stolen"})
    assert stolen.status_code == 403


def test_mux_routes_return_501_after_auth_checks(client, db, act_as):
    teacher = make_user(db, role="teacher")
    course, _section, lesson = make_course(db, teacher, lesson_type="video", lesson_title="Clip")
    student = make_user(db, role="student")

    unauthenticated = client.post(f"/api/v1/teacher/lessons/{lesson.id}/video-upload")
    assert unauthenticated.status_code == 401

    act_as(teacher)
    upload = client.post(f"/api/v1/teacher/lessons/{lesson.id}/video-upload")
    assert upload.status_code == 501
    assert upload.json()["detail"] == MUX_DETAIL

    act_as(student)
    blocked = client.get(f"/api/v1/lessons/{lesson.id}/playback")
    assert blocked.status_code == 403
    assert client.post(f"/api/v1/courses/{course.id}/enroll").status_code == 200
    playback = client.get(f"/api/v1/lessons/{lesson.id}/playback")
    assert playback.status_code == 501
    assert playback.json()["detail"] == MUX_DETAIL

    hook = client.post("/api/v1/webhooks/mux", json={"id": "evt_1", "type": "video.asset.ready"})
    assert hook.status_code == 501
    assert hook.json()["detail"] == MUX_DETAIL
    assert db.scalar(select(func.count()).select_from(WebhookEvent)) == 0


def test_javascript_url_rejected(client, db, act_as):
    teacher = make_user(db, role="teacher")
    _course, section, _lesson = make_course(db, teacher)
    act_as(teacher)
    response = client.post(
        f"/api/v1/teacher/sections/{section.id}/lessons",
        json={"title": "Bad link", "type": "link", "external_url": "javascript:alert(1)"},
    )
    assert response.status_code == 422


def test_reorder_lessons_swaps_positions(client, db, act_as):
    teacher = make_user(db, role="teacher")
    course, section, first = make_course(db, teacher, lesson_title="First")
    second = Lesson(
        section_id=section.id,
        title="Second",
        type="text",
        position=1,
        body_markdown="Second body",
    )
    db.add(second)
    db.commit()
    db.refresh(second)

    act_as(teacher)
    ordered = [str(second.id), str(first.id)]
    response = client.post(
        f"/api/v1/teacher/sections/{section.id}/lessons/reorder",
        json={"ordered_ids": ordered},
    )
    assert response.status_code == 200
    content = client.get(f"/api/v1/courses/{course.id}/content")
    assert content.status_code == 200
    lessons = content.json()["sections"][0]["lessons"]
    assert [lesson["id"] for lesson in lessons] == ordered
    assert [lesson["position"] for lesson in lessons] == [0, 1]


def test_analytics_overview_totals_match_seeded_users(client, db, act_as):
    make_user(db, role="student", full_name="One")
    make_user(db, role="student", full_name="Two")
    make_user(db, role="teacher", full_name="Teacher")
    admin = make_user(db, role="admin", full_name="Admin")
    act_as(admin)
    response = client.get("/api/v1/admin/analytics/overview")
    assert response.status_code == 200
    body = response.json()
    assert body["totals_by_role"] == {"student": 2, "teacher": 1, "admin": 1}
    assert isinstance(body["signups_by_day"], list)
    assert isinstance(body["enrollments_by_day"], list)
    assert isinstance(body["active_learners_by_day"], list)
    assert body["courses_by_status"]["draft"] == 0
