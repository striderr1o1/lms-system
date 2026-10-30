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
