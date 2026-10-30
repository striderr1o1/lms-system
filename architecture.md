# Backend architecture

This document describes the FastAPI backend only: how a request is authenticated, how roles are enforced, what each API does, and the Supabase SQL that stores the data. The React app is out of scope except where it must send a Supabase access token.

The API lives in `backend/app`. The schema that is already applied to the hosted database is `supabase/migrations/20261029163347_lms_initial_schema.sql`. The SQL is copied at the end of this file.

## Shape of the system

```
Browser
  |  Supabase Auth (email + password) returns an ES256 JWT
  |  Authorization: Bearer <access token>
  v
FastAPI  /api/v1
  |  verify JWT against the project JWKS
  |  load public.profiles by the token subject
  |  role and ownership checks
  v
SQLAlchemy session
  v
Supabase Postgres
  public.profiles, courses, sections, lessons,
  video_assets, enrollments, lesson_progress, webhook_events
```

Supabase Auth proves who the person is. The `profiles` row decides what they are allowed to do. The browser never queries tables. The API connects with `DATABASE_URL` as the database owner, so it bypasses row level security. The Data API roles (`anon`, `authenticated`, `service_role`) have no grants and no policies, so a public Supabase key cannot read these tables.

Video upload, playback, and the Mux webhook are stubs. After the normal permission checks they return HTTP 501. See `docs/MUX.md`.

## Code layout

| Path | Role |
| --- | --- |
| `main.py` | App, CORS, router mount, 501 and database-error handlers |
| `core/config.py` | Settings from `backend/.env` |
| `core/db.py` | Engine, session, commit or rollback per request |
| `core/security.py` | JWT verification and profile lookup |
| `core/deps.py` | FastAPI dependencies for optional user, current user, teacher, admin |
| `core/time.py` | `utcnow()` |
| `models/` | SQLAlchemy tables matching the hosted schema |
| `schemas/` | Pydantic request and response models, URL and lesson validation |
| `routers/health.py` | Liveness |
| `routers/courses.py` | Catalog, enroll, course content |
| `routers/me.py` | Profile, teacher application, my enrollments, my progress |
| `routers/lessons.py` | Playback stub, save progress |
| `routers/teacher.py` | Course builder |
| `routers/admin.py` | Users, course status, analytics |
| `routers/webhooks.py` | Mux webhook stub |
| `services/access.py` | Visibility, enrollment, ownership |
| `services/progress.py` | Completion rules and course completion |
| `services/ordering.py` | Section and lesson reorder |
| `services/analytics.py` | Admin charts |
| `services/mux.py` | Unimplemented Mux calls |

Every router is mounted at `/api/v1`.

## Request lifecycle

`get_db` opens one SQLAlchemy session for the request. If the handler returns normally, the session commits. If it raises, the session rolls back. The session always closes.

`Settings` reads `DATABASE_URL`, the Supabase URL, the JWKS URL, the expected JWT issuer and audience, `FRONTEND_ORIGIN`, and the empty Mux variables. CORS allows that one frontend origin and the `Authorization` header.

`MuxNotConfigured` becomes HTTP 501 with the detail `Mux is not configured yet. Follow docs/MUX.md.` A SQLAlchemy `OperationalError` becomes HTTP 500 with a message to check `DATABASE_URL`.

## Authentication

Signup and login happen in the browser with Supabase Auth. This API does not store passwords and does not issue tokens.

On signup, Supabase inserts `auth.users`. The trigger `private.handle_new_user` inserts `public.profiles` with the same id. The role is always `student`. `full_name` is copied from `raw_user_meta_data.full_name`. The role claim in that metadata is ignored, because users can edit their own metadata. A later email change on `auth.users` is copied onto the profile by `private.handle_user_email_change`.

Someone who wants to teach signs up as a student, then calls `POST /api/v1/me/teacher-application`. That sets `role = teacher` and `teacher_status = pending`. An admin approves them. The first admin is not created by the API. It is a direct SQL update:

```sql
update public.profiles
set role = 'admin', teacher_status = null
where email = 'you@example.com';
```

### Token check

Protected routes use `HTTPBearer`. The token is an ES256 JWT.

`decode_access_token` in `core/security.py`:

1. Fetches the signing key from `SUPABASE_JWKS_URL` (`PyJWKClient`, keys cached).
2. Verifies the signature, algorithm `ES256`, audience `authenticated`, and issuer `https://<project>.supabase.co/auth/v1`.
3. Any failure is HTTP 401 `Invalid token`.

`profile_from_token` reads `sub`, parses it as a UUID, and loads `profiles`. Missing profile is 401. `is_active = false` is 403 `Account is inactive`.

### Dependencies

| Dependency | Result |
| --- | --- |
| `get_optional_user` | `None` when the header is absent. A present token is still verified, so a bad token is 401 even on a public route that only optionally reads the user. |
| `get_current_user` | 401 `Not authenticated` when there is no token. |
| `require_approved_teacher` | 403 unless `role` is `teacher` and `teacher_status` is `approved`. Pending and rejected teachers fail here. |
| `require_admin` | 403 unless `role` is `admin`. |

The teacher router and the admin router also attach these dependencies to the whole router, so a student cannot reach those handlers.

## Authorization inside handlers

`services/access.py` is the second gate, after the role dependency.

`visible_course` is used by the public course page.

- A published course is visible to anyone.
- An admin can see a draft or archived course.
- An approved teacher can see their own draft or archived course.
- Anyone else gets 404, so unpublished ids are not confirmed.

`assert_learning_access` is used by course content and playback.

- An admin is allowed.
- An approved teacher who owns the course is allowed.
- Anyone else must be looking at a published course and must have an enrollment. Missing enrollment is 403. An unpublished course is 404.

`owned_course`, `owned_section`, and `owned_lesson` require `course.teacher_id == current teacher`. A teacher who does not own the row gets 403. Missing rows are 404.

Saving progress is stricter than viewing content: the caller must have an enrollment. Owning the course as a teacher is not enough. The check is inline in `save_progress`.

## Data the API reads and writes

`profiles.id` equals `auth.users.id`. The SQLAlchemy model does not declare that foreign key. The hosted database does. Tests create tables from the models on SQLite, which has no `auth` schema.

| Table | What it holds |
| --- | --- |
| `profiles` | Name, email, `student` / `teacher` / `admin`, teacher approval, active flag |
| `courses` | Owned by one teacher. `draft`, `published`, or `archived` |
| `sections` | Ordered children of a course. Unique `(course_id, position)` |
| `lessons` | `video`, `text`, `link`, or `file`. Ordered inside a section |
| `video_assets` | One Mux asset per video lesson. Unused until Mux is connected |
| `enrollments` | One row per student and course. `completed_at` when every lesson is done |
| `lesson_progress` | One row per student and lesson. Position and completed flag |
| `webhook_events` | Mux event ids for idempotency. Unused until the webhook is implemented |

Deleting a course is restricted while a profile still teaches it (`ON DELETE RESTRICT`). Deleting a course cascades to sections, lessons, video assets, and enrollments. Deleting a lesson cascades to its progress and video asset. Deleting an auth user cascades to the profile, which cascades to enrollments and progress. It fails if that profile still owns courses.

Teachers must have a non-null `teacher_status`. Students and admins must have a null `teacher_status`. The database check and `PATCH /admin/users/{id}` both enforce this.

## Validation

Pydantic models use `extra = forbid`, so a client cannot send `role` or `is_active` to `PATCH /me`.

`normalize_lesson_fields` in `schemas/__init__.py` is what create and update lesson call:

- Title is required, trimmed, and at most 200 characters.
- Text lessons need `body_markdown`.
- Link lessons need an `http` or `https` `external_url` with a host. `javascript:` and other schemes are rejected. Spaces and line breaks in the URL are rejected.
- File lessons need an `http` or `https` `file_url`.
- Thumbnails, when present, must be `https`.
- `duration_sec` cannot be negative.

Search strings escape `%`, `_`, and `\` before `ILIKE`, so a user cannot widen the pattern by typing a wildcard.

## APIs

Status codes used throughout: 401 missing or bad token, 403 authenticated but not allowed, 404 missing or hidden, 409 conflict (already a teacher, last admin, self-deactivate), 422 invalid body, 501 Mux not connected.

### Health

`GET /api/v1/health` → `{"status": "ok"}`. No database and no token. Function: `health`.

### Catalog and learning — `routers/courses.py`

| Method and path | Auth | Function | What it does |
| --- | --- | --- | --- |
| `GET /courses` | Public | `list_courses` | Published courses only. Filters `q` (title or description) and `category`. Page default 12, max 50, newest first. Joins the teacher for `teacher_name`. |
| `GET /courses/categories` | Public | `list_categories` | Distinct non-empty categories of published courses. |
| `GET /courses/{course_id}` | Optional | `get_course_detail` | `visible_course`, then the teacher name. |
| `POST /courses/{course_id}/enroll` | User | `enroll` | Published courses only. If an enrollment exists, returns it. Otherwise inserts one. Response includes progress counts and `resume_lesson_id` via `enrollment_read`. |
| `GET /courses/{course_id}/content` | User | `course_content` | `assert_learning_access`. Sections and lessons in position order. If the caller is enrolled, each lesson includes their progress. |

`enrollment_read` loads lessons with `ordered_lessons` (section position, then lesson position). `resume_lesson_id` is the first lesson that is not completed. If every lesson is completed, it is the first lesson.

`_like` builds the escaped search pattern. `_public` maps a course row to `CoursePublic`.

### Current user — `routers/me.py`

| Method and path | Auth | Function | What it does |
| --- | --- | --- | --- |
| `GET /me` | User | `read_me` | Returns the profile loaded from the token. |
| `PATCH /me` | User | `update_me` | Sets `full_name` only. |
| `POST /me/teacher-application` | User | `apply_teacher` | Students become `teacher` / `pending`. Anyone else gets 409. |
| `GET /me/enrollments` | User | `my_enrollments` | This user's enrollments, newest first, each passed through `enrollment_read`. |
| `GET /me/progress` | User | `my_progress` | Progress rows for this user. Optional `course_id` limits them to that course's lessons. Unknown course is 404. |

### Lessons — `routers/lessons.py`

| Method and path | Auth | Function | What it does |
| --- | --- | --- | --- |
| `GET /lessons/{lesson_id}/playback` | User | `playback` | `lesson_context`, then `assert_learning_access`. Non-video lessons are 400. Then `mux.sign_playback_token`, which raises and the route returns 501. |
| `POST /lessons/{lesson_id}/progress` | User | `save_progress` | Requires an enrollment. Upserts `lesson_progress` on `(student_id, lesson_id)`. A unique-constraint race uses a nested transaction and reloads the row. Then `recompute_course_completion`. |

Body: `{ "last_position_sec": <int >= 0>, "is_completed": <bool, optional> }`.

Completion is `lesson_is_complete`:

- Text, link, and file lessons complete only when `is_completed` is true. `false` clears it. Omitting the flag keeps the previous value.
- Video lessons complete when `is_completed` is true, or when `last_position_sec` is at least 90% of `duration_sec` and duration is greater than zero. Sending `is_completed: false` does not clear a lesson that already passes the 90% mark.

`recompute_course_completion` counts completed lessons against every lesson in the course. If they match and `completed_at` is null, it sets `completed_at` to now. If any lesson is missing, it clears `completed_at`. A course with zero lessons is never complete. Creating or deleting a lesson or section calls the same function so the enrollment flag stays aligned.

### Teacher — `routers/teacher.py`

Every route depends on `require_approved_teacher`. Paths below are under `/api/v1/teacher`.

| Method and path | Function | What it does |
| --- | --- | --- |
| `GET /courses` | `list_my_courses` | Courses whose `teacher_id` is the caller, recently updated first. |
| `POST /courses` | `create_course` | Inserts a `draft` owned by the caller. 201. |
| `PATCH /courses/{course_id}` | `update_course` | `owned_course`, then title, description, category, thumbnail. Does not change status. |
| `DELETE /courses/{course_id}` | `delete_course` | `owned_course`, then delete. Cascades in the database. Does not call Mux. 204. |
| `POST /courses/{course_id}/sections` | `create_section` | Appends at `max(position) + 1`, or 0. 201. |
| `PATCH /sections/{section_id}` | `update_section` | `owned_section`, retitles. |
| `DELETE /sections/{section_id}` | `delete_section` | Deletes the section and recomputes completion for the course. 204. |
| `POST /courses/{course_id}/sections/reorder` | `reorder_sections` | Body `{ "ordered_ids": [...] }` must be each section of that course once. |
| `POST /sections/{section_id}/lessons` | `create_lesson` | Appends a lesson, `normalize_lesson_fields` via `_apply_lesson`, recomputes completion. 201. |
| `PATCH /lessons/{lesson_id}` | `update_lesson` | `owned_lesson`. Only fields present in the body change. The merged result is validated again. |
| `DELETE /lessons/{lesson_id}` | `delete_lesson` | Deletes and recomputes completion. Does not call `mux.delete_asset`. 204. |
| `POST /sections/{section_id}/lessons/reorder` | `reorder_lessons` | Same ordered-id rule, inside one section. |
| `POST /lessons/{lesson_id}/video-upload` | `video_upload` | Owner and type `video`, then `mux.create_direct_upload`. Today that is 501. |
| `GET /courses/{course_id}/students` | `course_students` | Enrollments with name, email, dates, and completed lesson count. |

`_reorder` rejects duplicate or unknown ids with 400, then `apply_positions`.

`apply_positions` writes positions in two steps inside the same transaction. It first moves every row to a high temporary position and flushes, then writes `0..n-1`. That works on SQLite, which checks the unique `(parent, position)` constraint immediately. On Supabase the unique constraints are `DEFERRABLE INITIALLY DEFERRED`, so a single assignment would also work. The two-step write is what the code does for both.

Publishing a course is an admin action, not a teacher action.

### Admin — `routers/admin.py`

Every route depends on `require_admin`. Paths are under `/api/v1/admin`.

| Method and path | Function | What it does |
| --- | --- | --- |
| `GET /users` | `list_users` | Optional `role` and `q` (name or email). Page default 20, max 50. |
| `PATCH /users/{user_id}` | `update_user` | Sets `is_active`, `role`, and `teacher_status`. |
| `GET /courses` | `list_courses` | Every course, any status, with `enrollment_count`. |
| `PATCH /courses/{course_id}/status` | `update_course_status` | Body `{ "status": "draft" \| "published" \| "archived" }`. |
| `GET /analytics/overview` | `analytics_overview` | Calls `overview`. |
| `GET /analytics/courses` | `analytics_courses` | Calls `course_analytics`. |
| `GET /analytics/engagement` | `analytics_engagement` | Calls `engagement`. |

`update_user` rules:

- A teacher must keep a `teacher_status`. A student or admin must not have one.
- An admin cannot set their own `is_active` to false (409).
- Demoting the only admin is 409.
- Approving a teacher is `role: "teacher"` and `teacher_status: "approved"`. Rejecting is `teacher_status: "rejected"`.

### Analytics — `services/analytics.py`

The window is 30 days, ending at `utcnow()`.

`overview` returns:

- `totals_by_role` for student, teacher, and admin.
- `signups_by_day` from `profiles.created_at`.
- `courses_by_status`.
- `enrollments_by_day` from `enrollments.enrolled_at`.
- `active_learners_by_day`: distinct `student_id` values in `lesson_progress.updated_at` per UTC day.

Days are ISO dates. Days with no rows are omitted.

`course_analytics` returns the top 20 courses by enrollment count. `completion_rate` is enrollments whose `completed_at` is set, divided by enrollments in that course. The teacher leaderboard counts that teacher's courses, distinct enrolled students, and the same completion rate across those enrollments.

`engagement` lists published courses. Lessons are ordered by section position, then lesson position. `completed_count` is how many progress rows mark that lesson complete.

### Webhook — `routers/webhooks.py`

`POST /api/v1/webhooks/mux` reads the raw body and the `Mux-Signature` header, then calls `verify_webhook_signature`. That function always raises `MuxNotConfigured`, so the route returns 501. It does not check a user JWT and it does not insert `webhook_events`.

## Mux boundary — `services/mux.py`

These functions exist so the routes have a single place to call. Each one raises `MuxNotConfigured`. None of them performs HTTP.

| Function | Intended job, not implemented |
| --- | --- |
| `create_direct_upload` | Ask Mux for a one-time upload URL. Browser uploads the file. Insert `video_assets` as `waiting`. |
| `sign_playback_token` | RS256 playback token after the route has allowed the user. |
| `delete_asset` | Delete the Mux asset when a lesson or course is removed. Not called on delete today. |
| `verify_webhook_signature` | HMAC-SHA256 over the timestamp and the raw body. |
| `handle_webhook_event` | Idempotent update of `video_assets` from Mux events. Not called today. |

## Supabase SQL

Applied once, as migration `20261029163347`. Do not run it again on that database.

What the script does, in order:

1. Creates schema `private` and revokes it from the Data API roles.
2. Creates the eight tables, checks, and indexes.
3. Adds `private.set_updated_at` and `BEFORE UPDATE` triggers on courses, sections, lessons, video assets, and lesson progress. The API also sets `updated_at` in Python.
4. Adds `private.handle_new_user` and `private.handle_user_email_change` as `SECURITY DEFINER` with an empty `search_path`. Execute is revoked from `public`, `anon`, `authenticated`, and `service_role`, then granted to `supabase_auth_admin`, which is the role that inserts into `auth.users`.
5. Attaches those functions to `auth.users` insert and email update.
6. Enables row level security on every table and creates no policies. With no policy, `anon` and `authenticated` see nothing.
7. Revokes all privileges on the tables from `public`, `anon`, `authenticated`, and `service_role`.

The API user is the table owner and bypasses row level security. That is why the FastAPI process can read and write while the Supabase client cannot.

```sql
-- Applied to the hosted Supabase project as migration version 20261029163347.
-- Do not run this again against that database.
--
-- The API connects as the database owner and bypasses RLS.
-- anon/authenticated/service_role have no grants and no policies, so the Data API cannot read these tables.
-- Role is never copied from auth.users.raw_user_meta_data (user-editable).

create schema if not exists private;

revoke all on schema private from public, anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'student',
  teacher_status text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint profiles_full_name_length check (full_name is null or char_length(full_name) <= 200),
  constraint profiles_role_check check (role in ('student', 'teacher', 'admin')),
  constraint profiles_teacher_status_check check (
    teacher_status is null or teacher_status in ('pending', 'approved', 'rejected')
  ),
  constraint profiles_teacher_status_role_check check (
    (role = 'teacher' and teacher_status is not null)
    or (role <> 'teacher' and teacher_status is null)
  )
);

create unique index profiles_email_unique_idx on public.profiles (email) where email is not null;

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  description text,
  category text,
  thumbnail_url text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_title_not_blank check (char_length(btrim(title)) > 0),
  constraint courses_title_length check (char_length(title) <= 200),
  constraint courses_status_check check (status in ('draft', 'published', 'archived')),
  constraint courses_thumbnail_url_check check (
    thumbnail_url is null or thumbnail_url ~ '^https://'
  )
);

create index courses_teacher_id_idx on public.courses (teacher_id);
create index courses_status_created_at_idx on public.courses (status, created_at desc);
create index courses_category_idx on public.courses (category);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sections_title_not_blank check (char_length(btrim(title)) > 0),
  constraint sections_position_nonnegative check (position >= 0),
  constraint sections_course_position_unique unique (course_id, position) deferrable initially deferred
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  title text not null,
  type text not null,
  position integer not null,
  body_markdown text,
  external_url text,
  file_url text,
  duration_sec integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lessons_title_not_blank check (char_length(btrim(title)) > 0),
  constraint lessons_type_check check (type in ('video', 'text', 'link', 'file')),
  constraint lessons_position_nonnegative check (position >= 0),
  constraint lessons_duration_nonnegative check (duration_sec is null or duration_sec >= 0),
  constraint lessons_external_url_check check (
    external_url is null or external_url ~ '^https?://'
  ),
  constraint lessons_file_url_check check (
    file_url is null or file_url ~ '^https?://'
  ),
  constraint lessons_type_payload_check check (
    (type = 'text' and body_markdown is not null)
    or (type = 'link' and external_url is not null)
    or (type = 'file' and file_url is not null)
    or (type = 'video')
  ),
  constraint lessons_section_position_unique unique (section_id, position) deferrable initially deferred
);

create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons (id) on delete cascade,
  mux_upload_id text,
  mux_asset_id text,
  mux_playback_id text,
  status text not null default 'waiting',
  duration_sec numeric(12, 3),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_assets_status_check check (status in ('waiting', 'processing', 'ready', 'errored')),
  constraint video_assets_duration_nonnegative check (duration_sec is null or duration_sec >= 0)
);

create unique index video_assets_mux_upload_id_uidx
  on public.video_assets (mux_upload_id)
  where mux_upload_id is not null;

create unique index video_assets_mux_asset_id_uidx
  on public.video_assets (mux_asset_id)
  where mux_asset_id is not null;

create index video_assets_mux_playback_id_idx
  on public.video_assets (mux_playback_id)
  where mux_playback_id is not null;

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint enrollments_student_course_unique unique (student_id, course_id),
  constraint enrollments_completed_after_enrolled check (
    completed_at is null or completed_at >= enrolled_at
  )
);

create index enrollments_course_id_idx on public.enrollments (course_id);
create index enrollments_enrolled_at_idx on public.enrollments (enrolled_at);

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  is_completed boolean not null default false,
  last_position_sec integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint lesson_progress_student_lesson_unique unique (student_id, lesson_id),
  constraint lesson_progress_position_nonnegative check (last_position_sec >= 0)
);

create index lesson_progress_lesson_id_idx on public.lesson_progress (lesson_id);
create index lesson_progress_updated_at_idx on public.lesson_progress (updated_at);

create table public.webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger courses_set_updated_at
  before update on public.courses
  for each row execute function private.set_updated_at();

create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function private.set_updated_at();

create trigger lessons_set_updated_at
  before update on public.lessons
  for each row execute function private.set_updated_at();

create trigger video_assets_set_updated_at
  before update on public.video_assets
  for each row execute function private.set_updated_at();

create trigger lesson_progress_set_updated_at
  before update on public.lesson_progress
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  );
  return new;
end;
$$;

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = new.email
    where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function private.handle_user_email_change() from public, anon, authenticated, service_role;
revoke all on function private.set_updated_at() from public, anon, authenticated, service_role;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_user() to supabase_auth_admin;
grant execute on function private.handle_user_email_change() to supabase_auth_admin;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function private.handle_user_email_change();

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.sections enable row level security;
alter table public.lessons enable row level security;
alter table public.video_assets enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.webhook_events enable row level security;

revoke all on table
  public.profiles,
  public.courses,
  public.sections,
  public.lessons,
  public.video_assets,
  public.enrollments,
  public.lesson_progress,
  public.webhook_events
from public, anon, authenticated, service_role;

comment on table public.profiles is
  'App roles. Always created as student. Promote to teacher or admin only from the API or SQL. Do not trust user_metadata for role.';
```
