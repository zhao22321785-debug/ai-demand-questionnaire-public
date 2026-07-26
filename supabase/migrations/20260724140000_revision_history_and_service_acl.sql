create table public.employee_assessment_revisions (
  assessment_id uuid not null,
  revision integer not null check (revision > 0),
  batch_id uuid not null references public.survey_batches(id),
  user_id uuid not null,
  survey_version_id uuid not null references public.survey_versions(id),
  ai_use_status text not null check (ai_use_status in ('frequent', 'sometimes', 'tried_rarely', 'never')),
  non_use_reasons text[] not null,
  discontinuation_reasons text[] not null,
  ai_tool_ids uuid[] not null,
  ai_tool_other text,
  ai_scenarios text[] not null,
  pain_points text[] not null,
  has_explicit_demand boolean not null,
  dimension_answers jsonb not null,
  response_payload jsonb not null,
  analysis_status text not null check (analysis_status in ('pending', 'running', 'complete', 'failed', 'stale')),
  submitted_at timestamptz not null,
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (assessment_id, revision),
  check (private.is_valid_dimension_answers(dimension_answers)),
  check (jsonb_typeof(response_payload) = 'object'),
  check (jsonb_typeof(dimension_answers -> 0) = 'number'),
  check (
    ai_use_status <> 'never' or
    dimension_answers = jsonb_build_array(dimension_answers -> 0, null, null, null, null, null)
  ),
  check (
    ai_use_status = 'never' or
    (
      jsonb_typeof(dimension_answers -> 1) = 'number' and
      jsonb_typeof(dimension_answers -> 2) = 'number' and
      jsonb_typeof(dimension_answers -> 3) = 'number' and
      jsonb_typeof(dimension_answers -> 4) = 'number' and
      jsonb_typeof(dimension_answers -> 5) = 'number'
    )
  ),
  check (cardinality(ai_scenarios) <= 3),
  check (cardinality(pain_points) <= 3),
  check (
    (
      ai_use_status = 'never' and
      cardinality(non_use_reasons) > 0 and
      cardinality(discontinuation_reasons) = 0 and
      cardinality(ai_tool_ids) = 0 and
      ai_tool_other is null and
      cardinality(ai_scenarios) = 0
    ) or (
      ai_use_status <> 'never' and
      cardinality(non_use_reasons) = 0 and
      (cardinality(ai_tool_ids) > 0 or nullif(btrim(ai_tool_other), '') is not null) and
      cardinality(ai_scenarios) between 1 and 3
    )
  ),
  check (
    (ai_use_status = 'tried_rarely' and cardinality(discontinuation_reasons) > 0) or
    (ai_use_status <> 'tried_rarely' and cardinality(discontinuation_reasons) = 0)
  )
);

create table public.employee_task_demand_revisions (
  assessment_id uuid not null,
  revision integer not null check (revision > 0),
  task_id uuid not null,
  display_order smallint not null check (display_order between 1 and 3),
  title text not null check (nullif(btrim(title), '') is not null),
  current_process text not null check (nullif(btrim(current_process), '') is not null),
  main_problem text not null check (nullif(btrim(main_problem), '') is not null),
  occurrence text not null check (occurrence in ('daily', 'weekly', 'monthly_stage', 'project_event', 'irregular', 'unknown')),
  stability text not null check (stability in ('fixed', 'partly_fixed', 'variable', 'unknown')),
  audience text not null check (audience in ('self', 'same_position', 'cross_function', 'unknown')),
  ai_use_status text not null check (ai_use_status in ('using', 'stopped', 'never')),
  ai_follow_up text,
  expected_support text not null check (nullif(btrim(expected_support), '') is not null),
  source_created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (assessment_id, revision, task_id),
  unique (assessment_id, revision, display_order),
  foreign key (assessment_id, revision)
    references public.employee_assessment_revisions(assessment_id, revision),
  check (ai_use_status = 'never' or nullif(btrim(ai_follow_up), '') is not null)
);

create table public.position_survey_revisions (
  survey_id uuid not null,
  revision integer not null check (revision > 0),
  batch_id uuid not null references public.survey_batches(id),
  user_id uuid not null,
  survey_version_id uuid not null references public.survey_versions(id),
  researcher_name text not null check (nullif(btrim(researcher_name), '') is not null),
  department_id uuid references public.departments(id),
  department_other text,
  position_id uuid references public.positions(id),
  position_other text,
  position_key text not null,
  position_name text not null check (nullif(btrim(position_name), '') is not null),
  related_position_experience text not null check (related_position_experience in ('under_1', '1_3', '3_5', '5_10', 'over_10')),
  response_payload jsonb not null,
  analysis_status text not null check (analysis_status in ('pending', 'running', 'complete', 'failed', 'stale')),
  submitted_at timestamptz not null,
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (survey_id, revision),
  check (department_id is not null or nullif(btrim(department_other), '') is not null),
  check (position_id is not null or nullif(btrim(position_other), '') is not null),
  check (jsonb_typeof(response_payload) = 'object')
);

create table public.position_work_item_revisions (
  survey_id uuid not null,
  revision integer not null check (revision > 0),
  work_item_id uuid not null,
  display_order smallint not null check (display_order between 1 and 5),
  name text not null check (nullif(btrim(name), '') is not null),
  description text not null check (nullif(btrim(description), '') is not null),
  selected_for_improvement boolean not null,
  source_created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (survey_id, revision, work_item_id),
  unique (survey_id, revision, display_order),
  foreign key (survey_id, revision)
    references public.position_survey_revisions(survey_id, revision)
);

create table public.position_task_demand_revisions (
  survey_id uuid not null,
  revision integer not null check (revision > 0),
  task_id uuid not null,
  work_item_id uuid not null,
  display_order smallint not null check (display_order between 1 and 3),
  task text not null check (nullif(btrim(task), '') is not null),
  common_input text not null,
  has_fixed_input boolean not null,
  output text not null,
  has_fixed_output boolean not null,
  current_process text not null check (nullif(btrim(current_process), '') is not null),
  main_problem text not null check (nullif(btrim(main_problem), '') is not null),
  occurrence text not null check (occurrence in ('daily', 'weekly', 'monthly_stage', 'project_event', 'irregular', 'unknown')),
  stability text not null check (stability in ('fixed', 'partly_fixed', 'variable', 'unknown')),
  audience text not null check (audience in ('single', 'same_position', 'cross_function', 'unknown')),
  ai_participation text not null check (ai_participation in ('reference', 'assist', 'partial_automation', 'mostly_automated', 'unknown')),
  expected_ai_support text not null check (nullif(btrim(expected_ai_support), '') is not null),
  result_usage text not null check (result_usage in ('direct', 'human_review', 'reference_only', 'unknown')),
  human_review_content text,
  requires_collaboration boolean not null,
  collaboration_departments text[] not null,
  collaboration_positions text[] not null,
  handoff_content text,
  collaboration_problem text,
  collaboration_ai_support text,
  source_created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (survey_id, revision, task_id),
  unique (survey_id, revision, display_order),
  foreign key (survey_id, revision)
    references public.position_survey_revisions(survey_id, revision),
  foreign key (survey_id, revision, work_item_id)
    references public.position_work_item_revisions(survey_id, revision, work_item_id),
  check (not has_fixed_input or nullif(btrim(common_input), '') is not null),
  check (not has_fixed_output or nullif(btrim(output), '') is not null),
  check (
    result_usage not in ('human_review', 'reference_only') or
    nullif(btrim(human_review_content), '') is not null
  ),
  check (
    not requires_collaboration or
    (
      cardinality(collaboration_departments) + cardinality(collaboration_positions) > 0 and
      nullif(btrim(handoff_content), '') is not null and
      nullif(btrim(collaboration_problem), '') is not null and
      nullif(btrim(collaboration_ai_support), '') is not null
    )
  )
);

create index employee_assessment_revisions_user_batch_idx
on public.employee_assessment_revisions(user_id, batch_id, revision desc);

create index employee_assessment_revisions_batch_idx
on public.employee_assessment_revisions(batch_id, assessment_id, revision desc);

create index position_survey_revisions_user_batch_idx
on public.position_survey_revisions(user_id, batch_id, revision desc);

create index position_survey_revisions_batch_idx
on public.position_survey_revisions(batch_id, survey_id, revision desc);

create or replace function private.reject_revision_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'revision history is append-only' using errcode = '55000';
end;
$$;

revoke all on function private.reject_revision_history_mutation() from public, anon, authenticated, service_role;

create trigger prevent_employee_assessment_revisions_mutation
before update or delete on public.employee_assessment_revisions
for each row execute function private.reject_revision_history_mutation();

create trigger prevent_employee_task_demand_revisions_mutation
before update or delete on public.employee_task_demand_revisions
for each row execute function private.reject_revision_history_mutation();

create trigger prevent_position_survey_revisions_mutation
before update or delete on public.position_survey_revisions
for each row execute function private.reject_revision_history_mutation();

create trigger prevent_position_work_item_revisions_mutation
before update or delete on public.position_work_item_revisions
for each row execute function private.reject_revision_history_mutation();

create trigger prevent_position_task_demand_revisions_mutation
before update or delete on public.position_task_demand_revisions
for each row execute function private.reject_revision_history_mutation();

create or replace function private.archive_employee_assessment_revision(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision integer;
begin
  select assessment.revision into current_revision
  from public.employee_assessments assessment
  where assessment.id = p_assessment_id
  for update;

  if not found then
    raise exception 'employee assessment not found for revision archive' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.employee_assessment_revisions history
    where history.assessment_id = p_assessment_id
      and history.revision = current_revision
  ) then
    if (select count(*) from public.employee_task_demands task where task.assessment_id = p_assessment_id)
        <> (select count(*) from public.employee_task_demand_revisions history where history.assessment_id = p_assessment_id and history.revision = current_revision)
      or exists (
        select 1
        from public.employee_task_demands task
        left join public.employee_task_demand_revisions history
          on history.assessment_id = task.assessment_id
          and history.revision = current_revision
          and history.task_id = task.id
          and history.display_order = task.display_order
        where task.assessment_id = p_assessment_id
          and history.task_id is null
      )
      or exists (
        select 1
        from public.employee_task_demand_revisions history
        left join public.employee_task_demands task
          on task.assessment_id = history.assessment_id
          and task.id = history.task_id
          and task.display_order = history.display_order
        where history.assessment_id = p_assessment_id
          and history.revision = current_revision
          and task.id is null
      )
    then
      raise exception 'employee revision history children are incomplete' using errcode = '55000';
    end if;
    return;
  end if;

  insert into public.employee_assessment_revisions (
    assessment_id, revision, batch_id, user_id, survey_version_id, ai_use_status,
    non_use_reasons, discontinuation_reasons, ai_tool_ids, ai_tool_other,
    ai_scenarios, pain_points, has_explicit_demand, dimension_answers,
    response_payload, analysis_status, submitted_at, source_created_at, source_updated_at
  )
  select
    assessment.id, assessment.revision, assessment.batch_id, assessment.user_id,
    assessment.survey_version_id, assessment.ai_use_status, assessment.non_use_reasons,
    assessment.discontinuation_reasons, assessment.ai_tool_ids, assessment.ai_tool_other,
    assessment.ai_scenarios, assessment.pain_points, assessment.has_explicit_demand,
    assessment.dimension_answers, assessment.response_payload, assessment.analysis_status,
    assessment.submitted_at, assessment.created_at, assessment.updated_at
  from public.employee_assessments assessment
  where assessment.id = p_assessment_id;

  insert into public.employee_task_demand_revisions (
    assessment_id, revision, task_id, display_order, title, current_process,
    main_problem, occurrence, stability, audience, ai_use_status, ai_follow_up,
    expected_support, source_created_at
  )
  select
    task.assessment_id, current_revision, task.id, task.display_order, task.title,
    task.current_process, task.main_problem, task.occurrence, task.stability,
    task.audience, task.ai_use_status, task.ai_follow_up, task.expected_support,
    task.created_at
  from public.employee_task_demands task
  where task.assessment_id = p_assessment_id;
end;
$$;

revoke all on function private.archive_employee_assessment_revision(uuid) from public, anon, authenticated, service_role;

create or replace function private.archive_position_survey_revision(p_survey_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision integer;
begin
  select survey.revision into current_revision
  from public.position_demand_surveys survey
  where survey.id = p_survey_id
  for update;

  if not found then
    raise exception 'position survey not found for revision archive' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.position_survey_revisions history
    where history.survey_id = p_survey_id
      and history.revision = current_revision
  ) then
    if (select count(*) from public.position_work_items item where item.survey_id = p_survey_id)
        <> (select count(*) from public.position_work_item_revisions history where history.survey_id = p_survey_id and history.revision = current_revision)
      or exists (
        select 1
        from public.position_work_items item
        left join public.position_work_item_revisions history
          on history.survey_id = item.survey_id
          and history.revision = current_revision
          and history.work_item_id = item.id
          and history.display_order = item.display_order
        where item.survey_id = p_survey_id
          and history.work_item_id is null
      )
      or exists (
        select 1
        from public.position_work_item_revisions history
        left join public.position_work_items item
          on item.survey_id = history.survey_id
          and item.id = history.work_item_id
          and item.display_order = history.display_order
        where history.survey_id = p_survey_id
          and history.revision = current_revision
          and item.id is null
      )
      or (select count(*) from public.position_task_demands task where task.survey_id = p_survey_id)
        <> (select count(*) from public.position_task_demand_revisions history where history.survey_id = p_survey_id and history.revision = current_revision)
      or exists (
        select 1
        from public.position_task_demands task
        left join public.position_task_demand_revisions history
          on history.survey_id = task.survey_id
          and history.revision = current_revision
          and history.task_id = task.id
          and history.display_order = task.display_order
          and history.work_item_id = task.work_item_id
        where task.survey_id = p_survey_id
          and history.task_id is null
      )
      or exists (
        select 1
        from public.position_task_demand_revisions history
        left join public.position_task_demands task
          on task.survey_id = history.survey_id
          and task.id = history.task_id
          and task.display_order = history.display_order
          and task.work_item_id = history.work_item_id
        left join public.position_work_item_revisions item_history
          on item_history.survey_id = history.survey_id
          and item_history.revision = history.revision
          and item_history.work_item_id = history.work_item_id
        where history.survey_id = p_survey_id
          and history.revision = current_revision
          and (task.id is null or item_history.work_item_id is null)
      )
    then
      raise exception 'position revision history children are incomplete' using errcode = '55000';
    end if;
    return;
  end if;

  insert into public.position_survey_revisions (
    survey_id, revision, batch_id, user_id, survey_version_id, researcher_name,
    department_id, department_other, position_id, position_other, position_key,
    position_name, related_position_experience, response_payload, analysis_status,
    submitted_at, source_created_at, source_updated_at
  )
  select
    survey.id, survey.revision, survey.batch_id, survey.user_id, survey.survey_version_id,
    survey.researcher_name, survey.department_id, survey.department_other,
    survey.position_id, survey.position_other, survey.position_key, survey.position_name,
    survey.related_position_experience, survey.response_payload, survey.analysis_status,
    survey.submitted_at, survey.created_at, survey.updated_at
  from public.position_demand_surveys survey
  where survey.id = p_survey_id;

  insert into public.position_work_item_revisions (
    survey_id, revision, work_item_id, display_order, name, description,
    selected_for_improvement, source_created_at
  )
  select
    item.survey_id, current_revision, item.id, item.display_order, item.name,
    item.description, item.selected_for_improvement, item.created_at
  from public.position_work_items item
  where item.survey_id = p_survey_id;

  insert into public.position_task_demand_revisions (
    survey_id, revision, task_id, work_item_id, display_order, task, common_input,
    has_fixed_input, output, has_fixed_output, current_process, main_problem,
    occurrence, stability, audience, ai_participation, expected_ai_support,
    result_usage, human_review_content, requires_collaboration,
    collaboration_departments, collaboration_positions, handoff_content,
    collaboration_problem, collaboration_ai_support, source_created_at
  )
  select
    task.survey_id, current_revision, task.id, task.work_item_id, task.display_order,
    task.task, task.common_input, task.has_fixed_input, task.output, task.has_fixed_output,
    task.current_process, task.main_problem, task.occurrence, task.stability,
    task.audience, task.ai_participation, task.expected_ai_support, task.result_usage,
    task.human_review_content, task.requires_collaboration,
    task.collaboration_departments, task.collaboration_positions, task.handoff_content,
    task.collaboration_problem, task.collaboration_ai_support, task.created_at
  from public.position_task_demands task
  where task.survey_id = p_survey_id;
end;
$$;

revoke all on function private.archive_position_survey_revision(uuid) from public, anon, authenticated, service_role;

do $$
declare
  current_subject record;
begin
  for current_subject in select id, user_id, batch_id from public.employee_assessments loop
    perform pg_advisory_xact_lock(hashtextextended(
      current_subject.user_id::text || ':' || current_subject.batch_id::text,
      0
    ));
    perform private.archive_employee_assessment_revision(current_subject.id);
  end loop;

  for current_subject in select id, user_id, batch_id, position_key from public.position_demand_surveys loop
    perform pg_advisory_xact_lock(hashtextextended(
      current_subject.user_id::text || ':' || current_subject.batch_id::text || ':' || current_subject.position_key,
      0
    ));
    perform private.archive_position_survey_revision(current_subject.id);
  end loop;
end;
$$;

alter function private.save_employee_assessment(jsonb)
rename to save_employee_assessment_without_revision_history;

revoke all on function private.save_employee_assessment_without_revision_history(jsonb)
from public, anon, authenticated, service_role;

create or replace function private.save_employee_assessment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_assessment_id uuid;
  saved_assessment_id uuid;
  saved_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(current_user_id::text, '') || ':' || coalesce(((payload ->> 'batchId')::uuid)::text, ''),
    0
  ));

  select assessment.id into existing_assessment_id
  from public.employee_assessments assessment
  where assessment.user_id = current_user_id
    and assessment.batch_id = (payload ->> 'batchId')::uuid;

  if existing_assessment_id is not null then
    perform private.archive_employee_assessment_revision(existing_assessment_id);
  end if;

  saved_result := private.save_employee_assessment_without_revision_history(payload);
  saved_assessment_id := (saved_result ->> 'id')::uuid;
  perform private.archive_employee_assessment_revision(saved_assessment_id);
  return saved_result;
end;
$$;

revoke all on function private.save_employee_assessment(jsonb) from public, anon;
grant execute on function private.save_employee_assessment(jsonb) to authenticated;

create or replace function public.save_employee_assessment(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_employee_assessment(payload);
$$;

revoke all on function public.save_employee_assessment(jsonb) from public, anon;
grant execute on function public.save_employee_assessment(jsonb) to authenticated;

alter function private.save_position_survey(jsonb)
rename to save_position_survey_without_revision_history;

revoke all on function private.save_position_survey_without_revision_history(jsonb)
from public, anon, authenticated, service_role;

create or replace function private.save_position_survey(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_survey_id uuid;
  saved_survey_id uuid;
  saved_result jsonb;
  position_key_value text;
begin
  position_key_value := case
    when nullif(payload ->> 'positionId', '') is not null
      then 'std:' || ((payload ->> 'positionId')::uuid)::text
    else 'other:' || lower(regexp_replace(btrim(payload ->> 'positionName'), '\s+', ' ', 'g'))
  end;

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(current_user_id::text, '') || ':' || coalesce(((payload ->> 'batchId')::uuid)::text, '') || ':' || coalesce(position_key_value, ''),
    0
  ));

  select survey.id into existing_survey_id
  from public.position_demand_surveys survey
  where survey.user_id = current_user_id
    and survey.batch_id = (payload ->> 'batchId')::uuid
    and survey.position_key = position_key_value;

  if existing_survey_id is not null then
    perform private.archive_position_survey_revision(existing_survey_id);
  end if;

  saved_result := private.save_position_survey_without_revision_history(payload);
  saved_survey_id := (saved_result ->> 'id')::uuid;
  perform private.archive_position_survey_revision(saved_survey_id);
  return saved_result;
end;
$$;

revoke all on function private.save_position_survey(jsonb) from public, anon;
grant execute on function private.save_position_survey(jsonb) to authenticated;

create or replace function public.save_position_survey(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_position_survey(payload);
$$;

revoke all on function public.save_position_survey(jsonb) from public, anon;
grant execute on function public.save_position_survey(jsonb) to authenticated;

alter table public.employee_assessment_revisions enable row level security;
alter table public.employee_task_demand_revisions enable row level security;
alter table public.position_survey_revisions enable row level security;
alter table public.position_work_item_revisions enable row level security;
alter table public.position_task_demand_revisions enable row level security;

create policy employee_assessment_revisions_read_self_or_admin
on public.employee_assessment_revisions for select
to authenticated
using (
  (select private.is_active_user()) and
  ((select private.is_admin()) or user_id = (select auth.uid()))
);

create policy employee_task_demand_revisions_read_self_or_admin
on public.employee_task_demand_revisions for select
to authenticated
using (
  exists (
    select 1 from public.employee_assessment_revisions assessment
    where assessment.assessment_id = employee_task_demand_revisions.assessment_id
      and assessment.revision = employee_task_demand_revisions.revision
      and (select private.is_active_user())
      and ((select private.is_admin()) or assessment.user_id = (select auth.uid()))
  )
);

create policy position_survey_revisions_read_self_or_admin
on public.position_survey_revisions for select
to authenticated
using (
  (select private.is_active_user()) and
  ((select private.is_admin()) or user_id = (select auth.uid()))
);

create policy position_work_item_revisions_read_self_or_admin
on public.position_work_item_revisions for select
to authenticated
using (
  exists (
    select 1 from public.position_survey_revisions survey
    where survey.survey_id = position_work_item_revisions.survey_id
      and survey.revision = position_work_item_revisions.revision
      and (select private.is_active_user())
      and ((select private.is_admin()) or survey.user_id = (select auth.uid()))
  )
);

create policy position_task_demand_revisions_read_self_or_admin
on public.position_task_demand_revisions for select
to authenticated
using (
  exists (
    select 1 from public.position_survey_revisions survey
    where survey.survey_id = position_task_demand_revisions.survey_id
      and survey.revision = position_task_demand_revisions.revision
      and (select private.is_active_user())
      and ((select private.is_admin()) or survey.user_id = (select auth.uid()))
  )
);

revoke all on public.employee_assessment_revisions,
  public.employee_task_demand_revisions,
  public.position_survey_revisions,
  public.position_work_item_revisions,
  public.position_task_demand_revisions
from public, anon, authenticated, service_role;

grant select on public.employee_assessment_revisions, public.employee_task_demand_revisions, public.position_survey_revisions, public.position_work_item_revisions, public.position_task_demand_revisions to authenticated;

revoke all on schema public from service_role;
grant usage on schema public to service_role;

revoke all on public.departments, public.positions, public.ai_tool_options,
  public.survey_versions, public.survey_batches, public.user_roles, public.user_profiles,
  public.employee_assessments, public.employee_task_demands,
  public.position_demand_surveys, public.position_work_items, public.position_task_demands,
  public.analysis_jobs, public.analysis_results, public.aggregate_analysis_runs,
  public.employee_assessment_revisions, public.employee_task_demand_revisions,
  public.position_survey_revisions, public.position_work_item_revisions,
  public.position_task_demand_revisions
from service_role;

revoke all on public.admin_response_statistics, public.admin_dimension_statistics from service_role;

grant select on public.departments to service_role;
grant select on public.positions to service_role;
grant select on public.ai_tool_options to service_role;
grant select on public.survey_batches to service_role;
grant select on public.user_roles to service_role;
grant select on public.user_profiles to service_role;
grant select on public.employee_assessments to service_role;
grant update (analysis_status) on public.employee_assessments to service_role;
grant select on public.position_demand_surveys to service_role;
grant update (analysis_status) on public.position_demand_surveys to service_role;
grant select, insert, update on public.analysis_jobs to service_role;
grant select, insert, update on public.analysis_results to service_role;
grant select, insert, update on public.aggregate_analysis_runs to service_role;
grant select on public.admin_response_statistics, public.admin_dimension_statistics to service_role;

revoke all on function public.save_employee_assessment(jsonb), public.save_position_survey(jsonb) from service_role;
revoke all on function public.claim_analysis_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.finalize_analysis_job(uuid, text, jsonb, jsonb, integer, text, text) from public, anon, authenticated;
grant execute on function public.claim_analysis_job(uuid, text, text) to service_role;
grant execute on function public.finalize_analysis_job(uuid, text, jsonb, jsonb, integer, text, text) to service_role;
