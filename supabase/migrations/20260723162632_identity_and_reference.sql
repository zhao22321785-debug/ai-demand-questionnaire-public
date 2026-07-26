create schema if not exists private;

revoke all on schema private from public;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.ai_tool_options (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.survey_versions (
  id uuid primary key default gen_random_uuid(),
  survey_type text not null check (survey_type in ('employee', 'position')),
  version_key text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, survey_type),
  unique (survey_type, version_key)
);

create table public.survey_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  employee_survey_version_id uuid not null,
  employee_survey_type text not null default 'employee' check (employee_survey_type = 'employee'),
  position_survey_version_id uuid not null,
  position_survey_type text not null default 'position' check (position_survey_type = 'position'),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  foreign key (employee_survey_version_id, employee_survey_type)
    references public.survey_versions(id, survey_type),
  foreign key (position_survey_version_id, position_survey_type)
    references public.survey_versions(id, survey_type)
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  department_id uuid references public.departments(id),
  department_other text,
  position_id uuid references public.positions(id),
  position_other text,
  current_position_experience text check (
    current_position_experience is null or
    current_position_experience in ('under_1', '1_3', '3_5', '5_10', 'over_10')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (department_id is not null or nullif(btrim(department_other), '') is not null or name is null),
  check (position_id is not null or nullif(btrim(position_other), '') is not null or name is null)
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

create trigger set_user_roles_updated_at
before update on public.user_roles
for each row execute function private.set_updated_at();

create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (user_id, role, status)
  values (new.id, 'user', 'active')
  on conflict (user_id) do nothing;

  insert into public.user_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- The trigger only covers future sign-ups. Keep first deployment safe for projects
-- that already contain Auth users; administrator promotion remains a controlled step.
insert into public.user_roles (user_id, role, status)
select id, 'user', 'active'
from auth.users
on conflict (user_id) do nothing;

insert into public.user_profiles (user_id)
select id
from auth.users
on conflict (user_id) do nothing;

create index survey_batches_employee_version_idx
on public.survey_batches(employee_survey_version_id);

create index survey_batches_position_version_idx
on public.survey_batches(position_survey_version_id);

create index user_profiles_department_id_idx on public.user_profiles(department_id);
create index user_profiles_position_id_idx on public.user_profiles(position_id);
