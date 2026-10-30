# LMS Implementation Plan (Mux)

Technical implementation plan for the e-learning LMS: student, teacher and admin roles, with video handled by Mux. October 2026.

## 1. Goals and scope

**Goal:** a working, demo-ready LMS where teachers publish courses, students enroll and learn, and admins see analytics. Video must play reliably, and the architecture must not need a rewrite when moving from demo to production.

**In scope (MVP):**

- Student: register/login, browse and search courses, enroll, watch videos, read text, open links, track progress, resume where they left off.
- Teacher: create and edit courses, organize sections and lessons, upload videos to Mux, add text and links, see enrolled students.
- Admin: manage users and courses, approve teachers, view the analytics dashboard.

**Out of scope for v1:** quizzes, certificates, payments, discussions, live classes, email notifications, teacher-facing analytics.

## 2. Architecture

### 2.1 Components

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React (Vite), Tailwind, React Query, React Router | Fast to build, hosted free on Vercel |
| Backend API | FastAPI, SQLAlchemy 2, Alembic, Pydantic | Single place for authorization and Mux integration |
| Database | Supabase Postgres | Relational data and easy analytics SQL |
| Auth | Supabase Auth, roles in our own profiles table | No password reset or email verification to build |
| Video | Mux (direct uploads, signed playback, webhooks) | Transcoding, HLS and CDN handled for us |
| Small files | Supabase Storage (PDFs, thumbnails) | Optional, only if needed |
| Hosting | Vercel (frontend), Railway (backend) | Simple deploys from GitHub |

The backend needs no persistent disk. Videos live on Mux, data lives in Supabase, so a Railway redeploy loses nothing.

### 2.2 System diagram

```
                        +------------------+
                        |   Supabase Auth  |
                        +--------+---------+
                                 | JWT
+--------------+   HTTPS   +-----v------------+   SQL    +-------------------+
|  React SPA   +---------->+  FastAPI (API)   +--------->+ Supabase Postgres |
|  (Vercel)    |           |  (Railway)       |          +-------------------+
+------+-------+           +----+--------+----+
       |                        |        ^
       | 1. direct upload       | 2. create upload / sign playback token
       | (browser -> Mux)       v        | 3. webhooks (asset ready)
       |                   +----+--------+----+
       +------------------>+       Mux       |
       |   4. playback     |  (encode + CDN)  |
       +<------------------+------------------+
          HLS stream with signed token
```

**Key principle:** the video bytes never pass through our server. Our backend only creates upload URLs, receives webhooks, and issues short-lived playback tokens after checking enrollment.

### 2.3 Authentication and authorization

- The frontend signs in with Supabase Auth and sends the access token (JWT) in the `Authorization: Bearer` header.
- FastAPI verifies the JWT (via the project's JWKS endpoint, or the JWT secret on older projects), then loads the user's `profiles` row to get the role.
- Roles (`student`, `teacher`, `admin`) are enforced in FastAPI with dependencies such as `require_role("teacher")`. Never rely on hiding buttons in the UI.
- Teachers also pass ownership checks: `course.teacher_id == current_user.id`.
- New teachers register as `pending` and need admin approval before they can create courses.
- The frontend never queries tables directly. Enable Row Level Security on every table with no public policies, so nothing is readable through Supabase's auto-generated API even if the anon key is public. The backend connects with the database connection string.

## 3. Data model

```sql
profiles (
  id uuid primary key,              -- equals Supabase auth user id
  full_name text, email text unique,
  role text check (role in ('student','teacher','admin')) default 'student',
  teacher_status text check (teacher_status in ('pending','approved','rejected')),
  is_active boolean default true,
  created_at timestamptz default now()
)

courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references profiles(id),
  title text, description text, category text, thumbnail_url text,
  status text check (status in ('draft','published','archived')) default 'draft',
  created_at timestamptz default now()
)

sections (id uuid pk, course_id uuid fk, title text, position int)

lessons (
  id uuid pk, section_id uuid fk, title text,
  type text check (type in ('video','text','link','file')),
  position int,
  body_markdown text,              -- for text lessons
  external_url text,               -- for link lessons (e.g. YouTube)
  file_url text,                   -- for file lessons
  duration_sec int
)

video_assets (
  id uuid pk, lesson_id uuid unique fk,
  mux_upload_id text, mux_asset_id text, mux_playback_id text,
  status text check (status in ('waiting','processing','ready','errored')),
  duration_sec numeric, error_message text,
  created_at timestamptz default now(), updated_at timestamptz
)

enrollments (
  id uuid pk, student_id uuid fk, course_id uuid fk,
  enrolled_at timestamptz default now(), completed_at timestamptz,
  unique (student_id, course_id)
)

lesson_progress (
  id uuid pk, student_id uuid fk, lesson_id uuid fk,
  is_completed boolean default false, last_position_sec int default 0,
  updated_at timestamptz default now(),
  unique (student_id, lesson_id)
)

webhook_events (id text primary key, type text, received_at timestamptz)  -- idempotency
```

Indexes: foreign keys, `enrollments(course_id)`, `lesson_progress(updated_at)`, `courses(status)`, `video_assets(mux_asset_id)`, `video_assets(mux_upload_id)`.

Video details live in `video_assets` rather than on `lessons`. That keeps the lesson model clean and lets us swap providers later by adding a `provider` column.

## 4. Mux integration in detail

### 4.1 Setup

1. Create a Mux account and an access token (id and secret) with video permissions.
2. Create a **signing key** for signed playback (id plus private key). Store them as backend secrets.
3. Create a webhook endpoint in the Mux dashboard pointing to `https://<railway-domain>/webhooks/mux`, and copy its signing secret.
4. Check what your plan includes. At the time of writing, the free plan allows 10 video assets and 100,000 delivery minutes per month. Verify that signed playback is available on your plan; if not, use a public playback policy for the demo only.

### 4.2 Upload flow (teacher)

1. Teacher creates a video lesson and picks a file in the course builder.
2. Frontend calls `POST /teacher/lessons/{id}/video-upload`.
3. Backend checks ownership, then calls Mux `POST /video/v1/uploads` with:
   - `new_asset_settings.playback_policy = ["signed"]`
   - `new_asset_settings.passthrough = lesson_id` (comes back in webhooks so we can match the lesson)
   - `cors_origin` set to the frontend domain
4. Backend stores a `video_assets` row with `status = waiting` and the Mux upload id, and returns the one-time upload URL.
5. Browser uploads directly to Mux using the upload URL (use `@mux/upchunk` or Mux Uploader for chunked uploads and a progress bar).
6. Mux sends webhooks:
   - `video.upload.asset_created`: save `mux_asset_id`, set `status = processing`
   - `video.asset.ready`: save `mux_playback_id` and duration, set `status = ready`
   - `video.asset.errored`: set `status = errored` with a message
7. The frontend polls `GET /teacher/lessons/{id}` every few seconds (or refetches on focus) until status is `ready`, and shows "Processing..." in the meantime.

### 4.3 Webhook handler

- Endpoint: `POST /webhooks/mux`, public, no user auth.
- **Verify the signature** using the `Mux-Signature` header and the webhook signing secret (HMAC-SHA256 over timestamp and raw body, per Mux docs). Reject anything invalid. Use the raw request body, not re-serialized JSON.
- **Idempotency:** insert the event id into `webhook_events`; if it already exists, return 200 and do nothing.
- Always return 200 quickly. Keep handlers small and do heavy work elsewhere.
- For local testing, expose the backend with a tunnel (ngrok or cloudflared) and register that URL as a temporary webhook.

### 4.4 Playback flow (student)

1. Student opens a lesson; frontend calls `GET /lessons/{id}/playback`.
2. Backend checks: user is enrolled in the course (or is the owner teacher or an admin), the course is published, and the video status is `ready`.
3. Backend signs a JWT (RS256) with the Mux signing key:
   - header `kid` = signing key id
   - claims: `sub` = playback id, `aud` = `v` (video), `exp` = now + 2 to 6 hours
   - sign separate tokens for thumbnails (`aud = t`) and storyboards (`aud = s`) if used
4. Backend returns `{ playback_id, tokens: { playback, thumbnail, storyboard } }`.
5. Frontend renders `@mux/mux-player-react` with those values. Restore position with `startTime` from `last_position_sec`.
6. Refetch the token if it expires during a long session.

Because links expire and require a valid token issued only to enrolled users, shared URLs stop working.

### 4.5 Progress tracking

- Player events (`timeupdate`, `ended`) are throttled on the client to send `POST /lessons/{id}/progress` every 10 to 15 seconds with `last_position_sec`.
- Mark a lesson complete when the video ends or passes about 90 percent. Text and link lessons use a "Mark complete" button.
- Upsert on `(student_id, lesson_id)`.
- When all lessons in a course are complete, set `enrollments.completed_at`.

### 4.6 Cleanup

When a lesson or course is deleted, call Mux `DELETE /video/v1/assets/{id}` so unused videos do not count against plan limits. Do this in a background task and log failures.

### 4.7 Optional: Mux Data

Mux Player can report playback quality metrics (buffering, startup time) to Mux Data when you pass an environment key. Useful to prove smooth playback to stakeholders, but not required for the MVP.

## 5. API design

All endpoints return JSON, are versioned under `/api/v1`, and validate with Pydantic.

**Public and student**

- `GET /courses` (search, category, pagination), `GET /courses/{id}`
- `POST /courses/{id}/enroll`, `GET /me/enrollments`
- `GET /courses/{id}/content` (sections and lessons; requires enrollment)
- `GET /lessons/{id}/playback`
- `POST /lessons/{id}/progress`, `GET /me/progress`
- `GET /me`, `PATCH /me`

**Teacher**

- `POST/PATCH/DELETE /teacher/courses`, `GET /teacher/courses`
- `POST/PATCH/DELETE /teacher/courses/{id}/sections`, `POST /teacher/sections/{id}/reorder`
- `POST/PATCH/DELETE /teacher/lessons`
- `POST /teacher/lessons/{id}/video-upload`
- `GET /teacher/courses/{id}/students`

**Admin**

- `GET /admin/users`, `PATCH /admin/users/{id}` (activate, deactivate, approve teacher)
- `GET /admin/courses`, `PATCH /admin/courses/{id}/status`
- `GET /admin/analytics/overview`, `/courses`, `/engagement`

**System**

- `POST /webhooks/mux`, `GET /health`

## 6. Frontend plan

**Routes**

- Public: `/`, `/courses`, `/courses/:id`, `/login`, `/register`
- Student: `/learn` (dashboard), `/learn/:courseId/:lessonId` (player)
- Teacher: `/teach`, `/teach/courses/:id` (builder), `/teach/courses/:id/students`
- Admin: `/admin`, `/admin/users`, `/admin/courses`, `/admin/analytics`

**Key components**

- Route guards by role, driven by `/me`
- Course player: sidebar of sections and lessons with completion ticks, main area switching by lesson type (Mux Player, markdown renderer, link card or embed, file download)
- Course builder: sections and lessons list with drag-and-drop ordering (dnd-kit), lesson editor drawer, video upload with progress and status badge
- Admin charts with Recharts

**State:** React Query for server state, minimal local state, and an API client that attaches the Supabase token.

## 7. Admin analytics

All answerable from existing tables with SQL, no extra tracking needed for the MVP.

- Totals by role, new signups per day or week
- Courses by status, top courses by enrollments
- Enrollments over time
- Completion rate per course: `completed_at IS NOT NULL` divided by enrollments
- Active learners: distinct students in `lesson_progress.updated_at` per day or week
- Drop-off: for each lesson, count of students who completed it, ordered by position
- Teacher leaderboard: courses, students, completion rate

Example, enrollments per day for the last 30 days:

```sql
select date_trunc('day', enrolled_at) as day, count(*)
from enrollments
where enrolled_at > now() - interval '30 days'
group by 1 order by 1;
```

Compute these in the backend and return chart-ready arrays. If queries get slow later, add materialized views.

## 8. Security checklist

- Signature verification and idempotency on the Mux webhook
- Signed playback policy plus short-lived tokens, issued only after an enrollment check
- Mux and Supabase secrets only in backend environment variables; the frontend gets only the Supabase URL and anon key
- Row Level Security enabled on all tables, no public policies
- CORS restricted to the frontend origin; Mux upload `cors_origin` also restricted
- Teacher approval flow, ownership checks on every mutation
- Input validation with Pydantic; sanitize or safely render teacher-provided markdown
- Validate external link URLs (http or https only); embed only allow-listed hosts such as YouTube
- Rate limit auth-adjacent and upload-creation endpoints
- Limit uploads in the UI to video file types and a sensible size

## 9. Environments and configuration

**Backend env vars**

```
DATABASE_URL=
SUPABASE_URL=
SUPABASE_JWKS_URL=        # or SUPABASE_JWT_SECRET for legacy projects
MUX_TOKEN_ID=
MUX_TOKEN_SECRET=
MUX_SIGNING_KEY_ID=
MUX_SIGNING_PRIVATE_KEY=  # base64 from Mux
MUX_WEBHOOK_SECRET=
FRONTEND_ORIGIN=
```

**Frontend env vars:** `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

**Environments:** local (tunnel for webhooks), and one hosted environment for the demo. Use a separate Mux environment for development and production so test videos never count against the real account.

**Suggested repo layout (monorepo)**

```
lms/
  backend/
    app/
      main.py
      core/ (config.py, security.py, deps.py)
      models/ schemas/
      routers/ (auth, courses, lessons, teacher, admin, webhooks)
      services/ (mux.py, progress.py, analytics.py)
    alembic/
    tests/
  frontend/
    src/ (pages, components, api, hooks, routes)
  docs/
```

Keep all Mux logic inside `services/mux.py` (create upload, sign token, delete asset, verify webhook). The rest of the app calls that service only.

## 10. Build phases

| Phase | Scope | Done when |
| --- | --- | --- |
| 1. Foundation (3 to 4 days) | Repos, Supabase project, schema and migrations, auth integration, role dependencies, profiles on signup, CI lint and tests | A user can sign in and `/me` returns the right role |
| 2. Course management (4 to 5 days) | Teacher CRUD for courses, sections, lessons; text and link lessons; publish toggle; catalog and course detail pages | Teacher creates a course, student sees it in the catalog |
| 3. Mux video (4 to 5 days) | Direct upload, webhook handler, status polling, signed playback, player integration | A teacher uploads a video and an enrolled student plays it |
| 4. Student learning (3 to 4 days) | Enrollment, player layout, progress and resume, completion | Progress persists across sessions |
| 5. Admin (3 to 4 days) | User and course management, teacher approval, analytics dashboard | Dashboard shows real numbers |
| 6. Demo hardening (3 to 4 days) | Seed data, error states, loading states, deploy to Vercel and Railway, full dry run, backup content | Clean run-through on the demo device and network |

Realistic total for a solo developer: about 4 to 5 weeks. For a faster demo, cut to a vertical slice first: one teacher, one course with one Mux video, one student, a basic admin page, then widen.

## 11. Testing strategy

- **Backend unit tests (pytest):** authorization matrix (each role against each endpoint), enrollment gating on playback, progress upserts, token signing claims.
- **Webhook tests:** replay recorded Mux payloads, including duplicates and invalid signatures.
- **Integration:** run against a test database; mock Mux HTTP calls with `respx` or similar.
- **Frontend:** component tests for the player page states (processing, ready, errored); a couple of Playwright flows (login, enroll, watch).
- **Manual before demo:** upload a real video end to end, play on mobile data, seek, resume from a saved position, expire a token and confirm it refreshes.

## 12. Demo preparation

- Seed 3 courses with 2 to 3 lessons each, including at least 2 Mux videos, 1 text lesson and 1 YouTube link lesson as a backup.
- Seed 10 to 20 students with varied enrollment dates and progress so charts have shape.
- Upload demo videos in advance. Do not rely on a live upload, though keep one flow ready to show it.
- Prepare videos as 720p H.264 MP4 under a few minutes each; Mux will transcode them anyway but small files upload quickly.
- Keep a screen recording of the full flow as a final fallback.
- Watch plan limits: delete test assets so the 10-asset free limit is not hit before the demo.

## 13. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Mux free plan asset or feature limits | Track asset count, delete test uploads, confirm signed playback availability early, upgrade if needed |
| Webhook missed or delayed | Idempotent handler, plus a fallback "refresh status" endpoint that fetches the asset from the Mux API |
| Token expires mid-lesson | Client refetches token on player error or before expiry |
| Vendor lock-in | Isolate Mux code in one service; add a `provider` column if a second provider is ever needed |
| Upload fails on poor network | Chunked uploads with retry (upchunk), clear error and retry button |
| Scope creep before the demo | Keep the vertical slice first; defer anything from the out-of-scope list |

## 14. After the demo

- Teacher-facing analytics and richer admin reports
- Quizzes and certificates
- Email notifications (new enrollment, course published)
- Payments if courses become paid; the enrollment model already supports an added `order_id`
- Captions and subtitles (Mux supports auto-generated captions)
- Move per-lesson progress events into a dedicated activity table for deeper analytics
