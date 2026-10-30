# LMS

Students enroll and study. Approved teachers build courses. Admins approve teachers, publish courses, and read analytics. Video upload and playback are not wired up yet. See [docs/MUX.md](docs/MUX.md).

The Supabase schema is already applied. Do not run `supabase/migrations/20261029163347_lms_initial_schema.sql` again. The API uses the database connection string. The browser uses Supabase only for sign-up, sign-in, and sign-out.

## Backend

Install [uv](https://docs.astral.sh/uv/) and use Python 3.12 (the app pins `>=3.12,<3.13` because the machine default may be 3.14).

```bash
cd backend
uv sync
cp .env.example .env
```

Set `DATABASE_URL` in `backend/.env`. In the Supabase dashboard open **Project Settings → Database** and copy the **session mode** URI (port **5432**). Do not use the transaction pooler (port 6543). The user is `postgres.glmexxzdqstjcucojzff`. Change the scheme to SQLAlchemy’s psycopg driver:

```text
postgresql+psycopg://postgres.glmexxzdqstjcucojzff:PASSWORD@HOST:5432/postgres
```

The hosted database password is not in this repo. Paste it locally. Do not commit `.env`.

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

From the repo root, the same process is:

```bash
uv run --project backend uvicorn app.main:app --reload --app-dir backend --port 8000
```

The API is `http://localhost:8000`. Interactive docs are at `http://localhost:8000/docs`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. `frontend/.env` points the app at `http://localhost:8000` and the Supabase project. The publishable key is public and is safe in the client. Role is never read from user metadata.

Email confirmation may be turned on in the Supabase project. If registration returns no session, the form tells you to confirm the email and then log in. Choosing **Teacher** does not put a role in user metadata. After a session exists, the app calls `POST /api/v1/me/teacher-application`, which sets `role = teacher` and `teacher_status = pending` only when the account is still a student.

## First admin

Register in the app and confirm the email if Supabase asks you to. Then run this in the Supabase SQL editor. Replace the email with the account you just created.

```sql
update public.profiles
set role = 'admin', teacher_status = null
where email = 'you@example.com';
```

Log out and log in again so the client loads `GET /api/v1/me`. Open **Admin**.

## Approve a teacher and publish a course

1. Register a second account and choose **Teacher**.
2. Confirm the email if asked, then log in. **Teach** explains that the application is pending. The builder stays closed.
3. As the admin, open **Admin → Users** and approve that teacher.
4. Log in as the teacher. Create a course, add a section, and add a lesson. New courses start as drafts.
5. As the admin, open **Admin → Courses** and set the course to **Published**.
6. As a student, open the catalog, enroll, and open the lesson. Text, link, and file lessons have **Mark complete**. A video lesson can be saved, but the upload control is disabled. Upload, playback, and the Mux webhook return HTTP 501 until [docs/MUX.md](docs/MUX.md) is implemented.

An admin cannot deactivate their own account. The API also refuses to demote the last admin.

## Tests

```bash
cd backend
uv run pytest
```

Tests use an in-memory SQLite database. They do not need Docker or the hosted database.

Frontend production build:

```bash
cd frontend
npm run build
```
