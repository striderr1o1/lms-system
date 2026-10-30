import uuid
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

LessonType = Literal["video", "text", "link", "file"]
CourseStatus = Literal["draft", "published", "archived"]
RoleName = Literal["student", "teacher", "admin"]
TeacherStatus = Literal["pending", "approved", "rejected"]


def clean_title(value: str | None) -> str:
    if value is None or not value.strip():
        raise ValueError("Title is required")
    title = value.strip()
    if len(title) > 200:
        raise ValueError("Title must be 200 characters or fewer")
    return title


def _checked_url(value: str, field: str, *, https_only: bool) -> str:
    raw = value.strip()
    if any(char in raw for char in ("\r", "\n", "\t", " ")):
        raise ValueError(f"{field} must be an http or https URL")
    parsed = urlparse(raw)
    scheme = parsed.scheme.lower()
    allowed = {"https"} if https_only else {"http", "https"}
    if scheme not in allowed or not parsed.netloc:
        if https_only:
            raise ValueError(f"{field} must be an https URL")
        raise ValueError(f"{field} must be an http or https URL")
    return raw


def https_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return _checked_url(value, "thumbnail_url", https_only=True)


def optional_http_url(value: str | None, field: str) -> str | None:
    if value is None or not str(value).strip():
        return None
    return _checked_url(str(value), field, https_only=False)


def blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def normalize_lesson_fields(
    *,
    type_: str,
    title: str | None,
    body_markdown: str | None,
    external_url: str | None,
    file_url: str | None,
    duration_sec: int | None,
) -> tuple[str, str | None, str | None, str | None, int | None]:
    cleaned_title = clean_title(title)
    if type_ not in ("video", "text", "link", "file"):
        raise ValueError("Invalid lesson type")
    if duration_sec is not None and duration_sec < 0:
        raise ValueError("duration_sec must be >= 0")
    external = optional_http_url(external_url, "external_url")
    file_url_clean = optional_http_url(file_url, "file_url")
    body = body_markdown.strip() if isinstance(body_markdown, str) else None
    if body == "":
        body = None
    if type_ == "text" and not body:
        raise ValueError("Text lessons require body_markdown")
    if type_ == "link" and external is None:
        raise ValueError("Link lessons require an http or https external_url")
    if type_ == "file" and file_url_clean is None:
        raise ValueError("File lessons require an http or https file_url")
    return cleaned_title, body, external, file_url_clean, duration_sec


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel):
    items: list
    page: int
    page_size: int
    total: int


class ProfileRead(ORMModel):
    id: uuid.UUID
    full_name: str | None
    email: str | None
    role: str
    teacher_status: str | None
    is_active: bool
    created_at: datetime


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(min_length=1, max_length=200)

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("full_name is required")
        return name


class AdminUserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: bool | None = None
    role: RoleName | None = None
    teacher_status: TeacherStatus | None = None


class CoursePublic(ORMModel):
    id: uuid.UUID
    teacher_id: uuid.UUID
    teacher_name: str | None = None
    title: str
    description: str | None
    category: str | None
    thumbnail_url: str | None
    status: str
    created_at: datetime
    updated_at: datetime


class CourseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    description: str | None = None
    category: str | None = None
    thumbnail_url: str | None = None

    @field_validator("title")
    @classmethod
    def title_ok(cls, value: str) -> str:
        return clean_title(value)

    @field_validator("description", "category")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return blank_to_none(value)

    @field_validator("thumbnail_url")
    @classmethod
    def thumb(cls, value: str | None) -> str | None:
        return https_url(value)


class CourseUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    description: str | None = None
    category: str | None = None
    thumbnail_url: str | None = None

    @field_validator("title")
    @classmethod
    def title_ok(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return clean_title(value)

    @field_validator("description", "category")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return blank_to_none(value)

    @field_validator("thumbnail_url")
    @classmethod
    def thumb(cls, value: str | None) -> str | None:
        return https_url(value)


class CourseStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: CourseStatus


class AdminCourseRead(CoursePublic):
    enrollment_count: int = 0


class SectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str

    @field_validator("title")
    @classmethod
    def title_ok(cls, value: str) -> str:
        return clean_title(value)


class SectionUpdate(SectionCreate):
    pass


class SectionRead(ORMModel):
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    position: int
    created_at: datetime
    updated_at: datetime


class LessonCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    type: LessonType
    body_markdown: str | None = None
    external_url: str | None = None
    file_url: str | None = None
    duration_sec: int | None = Field(default=None, ge=0)


class LessonUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    type: LessonType | None = None
    body_markdown: str | None = None
    external_url: str | None = None
    file_url: str | None = None
    duration_sec: int | None = Field(default=None, ge=0)


class LessonRead(ORMModel):
    id: uuid.UUID
    section_id: uuid.UUID
    title: str
    type: str
    position: int
    body_markdown: str | None
    external_url: str | None
    file_url: str | None
    duration_sec: int | None
    created_at: datetime
    updated_at: datetime


class ReorderBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ordered_ids: list[uuid.UUID] = Field(min_length=0)


class ProgressBrief(BaseModel):
    is_completed: bool
    last_position_sec: int


class LessonContent(BaseModel):
    id: uuid.UUID
    title: str
    type: str
    position: int
    body_markdown: str | None = None
    external_url: str | None = None
    file_url: str | None = None
    duration_sec: int | None = None
    progress: ProgressBrief | None = None


class SectionContent(BaseModel):
    id: uuid.UUID
    title: str
    position: int
    lessons: list[LessonContent]


class CourseContent(BaseModel):
    course_id: uuid.UUID
    title: str
    status: str
    sections: list[SectionContent]


class ProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    last_position_sec: int = Field(ge=0)
    is_completed: bool | None = None


class ProgressRead(ORMModel):
    id: uuid.UUID
    lesson_id: uuid.UUID
    student_id: uuid.UUID
    is_completed: bool
    last_position_sec: int
    updated_at: datetime


class EnrollmentRead(BaseModel):
    id: uuid.UUID
    student_id: uuid.UUID
    course_id: uuid.UUID
    enrolled_at: datetime
    completed_at: datetime | None
    course_title: str
    course_category: str | None
    course_status: str
    thumbnail_url: str | None = None
    completed_lesson_count: int
    lesson_count: int
    resume_lesson_id: uuid.UUID | None = None


class CourseStudentRead(BaseModel):
    student_id: uuid.UUID
    name: str | None
    email: str | None
    enrolled_at: datetime
    completed_at: datetime | None
    completed_lesson_count: int


class DayCount(BaseModel):
    day: str
    count: int


class OverviewAnalytics(BaseModel):
    totals_by_role: dict[str, int]
    signups_by_day: list[DayCount]
    courses_by_status: dict[str, int]
    enrollments_by_day: list[DayCount]
    active_learners_by_day: list[DayCount]
    window_days: int = 30


class TopCourse(BaseModel):
    course_id: uuid.UUID
    title: str
    status: str
    teacher_id: uuid.UUID
    enrollment_count: int
    completion_rate: float


class TeacherLeaderboardRow(BaseModel):
    teacher_id: uuid.UUID
    full_name: str | None
    email: str | None
    course_count: int
    student_count: int
    completion_rate: float


class CourseAnalytics(BaseModel):
    top_courses: list[TopCourse]
    teacher_leaderboard: list[TeacherLeaderboardRow]


class EngagementLesson(BaseModel):
    lesson_id: uuid.UUID
    title: str
    section_title: str
    section_position: int
    lesson_position: int
    completed_count: int


class EngagementCourse(BaseModel):
    course_id: uuid.UUID
    title: str
    lessons: list[EngagementLesson]


class EngagementAnalytics(BaseModel):
    courses: list[EngagementCourse]
