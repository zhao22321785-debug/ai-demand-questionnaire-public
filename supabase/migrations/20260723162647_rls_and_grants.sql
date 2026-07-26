create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and status = 'active'
  );
$$;

revoke all on function private.is_active_user() from public, anon, authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'admin'
      and status = 'active'
  );
$$;

revoke all on function private.is_admin() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.is_admin() to authenticated;

alter table public.departments enable row level security;
alter table public.positions enable row level security;
alter table public.ai_tool_options enable row level security;
alter table public.survey_versions enable row level security;
alter table public.survey_batches enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_profiles enable row level security;
alter table public.employee_assessments enable row level security;
alter table public.employee_task_demands enable row level security;
alter table public.position_demand_surveys enable row level security;
alter table public.position_work_items enable row level security;
alter table public.position_task_demands enable row level security;

create policy departments_read_authenticated
on public.departments for select
to authenticated
using ((select private.is_active_user()) and (is_active or (select private.is_admin())));

create policy positions_read_authenticated
on public.positions for select
to authenticated
using ((select private.is_active_user()) and (is_active or (select private.is_admin())));

create policy ai_tool_options_read_authenticated
on public.ai_tool_options for select
to authenticated
using ((select private.is_active_user()) and (is_active or (select private.is_admin())));

create policy survey_versions_read_authenticated
on public.survey_versions for select
to authenticated
using ((select private.is_active_user()) and (status = 'active' or (select private.is_admin())));

create policy survey_batches_read_authenticated
on public.survey_batches for select
to authenticated
using (
  (select private.is_active_user()) and
  (
    (
      status = 'active' and
      (starts_at is null or now() >= starts_at) and
      (ends_at is null or now() < ends_at)
    ) or (select private.is_admin())
  )
);

create policy user_roles_read_self_or_admin
on public.user_roles for select
to authenticated
using (
  (select private.is_active_user()) and
  (user_id = (select auth.uid()) or (select private.is_admin()))
);

create policy user_profiles_read_self_or_admin
on public.user_profiles for select
to authenticated
using (
  (select private.is_active_user()) and
  (user_id = (select auth.uid()) or (select private.is_admin()))
);

create policy user_profiles_insert_self
on public.user_profiles for insert
to authenticated
with check ((select private.is_active_user()) and user_id = (select auth.uid()));

create policy user_profiles_update_self
on public.user_profiles for update
to authenticated
using ((select private.is_active_user()) and user_id = (select auth.uid()))
with check ((select private.is_active_user()) and user_id = (select auth.uid()));

create policy employee_assessments_read_self_or_admin
on public.employee_assessments for select
to authenticated
using (
  (select private.is_active_user()) and
  (user_id = (select auth.uid()) or (select private.is_admin()))
);

create policy employee_task_demands_read_self_or_admin
on public.employee_task_demands for select
to authenticated
using (
  (select private.is_active_user()) and
  exists (
    select 1
    from public.employee_assessments assessment
    where assessment.id = employee_task_demands.assessment_id
      and (assessment.user_id = (select auth.uid()) or (select private.is_admin()))
  )
);

create policy position_demand_surveys_read_self_or_admin
on public.position_demand_surveys for select
to authenticated
using (
  (select private.is_active_user()) and
  (user_id = (select auth.uid()) or (select private.is_admin()))
);

create policy position_work_items_read_self_or_admin
on public.position_work_items for select
to authenticated
using (
  (select private.is_active_user()) and
  exists (
    select 1
    from public.position_demand_surveys survey
    where survey.id = position_work_items.survey_id
      and (survey.user_id = (select auth.uid()) or (select private.is_admin()))
  )
);

create policy position_task_demands_read_self_or_admin
on public.position_task_demands for select
to authenticated
using (
  (select private.is_active_user()) and
  exists (
    select 1
    from public.position_demand_surveys survey
    where survey.id = position_task_demands.survey_id
      and (survey.user_id = (select auth.uid()) or (select private.is_admin()))
  )
);

revoke all on all tables in schema public from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.departments, public.positions, public.ai_tool_options to authenticated;
grant select on public.survey_versions, public.survey_batches to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update on public.user_profiles to authenticated;
grant select on public.employee_assessments, public.employee_task_demands to authenticated;
grant select on public.position_demand_surveys, public.position_work_items, public.position_task_demands to authenticated;
