create or replace function private.is_valid_dimension_answers(value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) <> 6 then
    return false;
  end if;

  return not exists (
    select 1
    from jsonb_array_elements(value) as answer(item)
    where jsonb_typeof(answer.item) not in ('number', 'null')
      or (jsonb_typeof(answer.item) = 'number' and answer.item::text !~ '^[1-5]$')
  );
end;
$$;

revoke all on function private.is_valid_dimension_answers(jsonb) from public, anon, authenticated;

create table public.employee_assessments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.survey_batches(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  survey_version_id uuid not null references public.survey_versions(id),
  ai_use_status text not null check (ai_use_status in ('frequent', 'sometimes', 'tried_rarely', 'never')),
  non_use_reasons text[] not null default '{}',
  discontinuation_reasons text[] not null default '{}',
  ai_tool_ids uuid[] not null default '{}',
  ai_tool_other text,
  ai_scenarios text[] not null default '{}',
  pain_points text[] not null default '{}',
  has_explicit_demand boolean not null,
  dimension_answers jsonb not null default '[null,null,null,null,null,null]'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  analysis_status text not null default 'pending' check (analysis_status in ('pending', 'running', 'complete', 'failed', 'stale')),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_assessments_batch_id_user_id_key unique (batch_id, user_id),
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

create table public.employee_task_demands (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.employee_assessments(id) on delete cascade,
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
  created_at timestamptz not null default now(),
  unique (assessment_id, display_order),
  check (ai_use_status = 'never' or nullif(btrim(ai_follow_up), '') is not null)
);

create table public.position_demand_surveys (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.survey_batches(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  survey_version_id uuid not null references public.survey_versions(id),
  researcher_name text not null check (nullif(btrim(researcher_name), '') is not null),
  department_id uuid references public.departments(id),
  department_other text,
  position_id uuid references public.positions(id),
  position_other text,
  position_key text not null,
  position_name text not null check (nullif(btrim(position_name), '') is not null),
  related_position_experience text not null check (related_position_experience in ('under_1', '1_3', '3_5', '5_10', 'over_10')),
  response_payload jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  analysis_status text not null default 'pending' check (analysis_status in ('pending', 'running', 'complete', 'failed', 'stale')),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint position_demand_surveys_batch_id_user_id_position_key_key unique (batch_id, user_id, position_key),
  check (department_id is not null or nullif(btrim(department_other), '') is not null),
  check (position_id is not null or nullif(btrim(position_other), '') is not null),
  check (jsonb_typeof(response_payload) = 'object')
);

create table public.position_work_items (
  id uuid primary key,
  survey_id uuid not null references public.position_demand_surveys(id) on delete cascade,
  display_order smallint not null check (display_order between 1 and 5),
  name text not null check (nullif(btrim(name), '') is not null),
  description text not null check (nullif(btrim(description), '') is not null),
  selected_for_improvement boolean not null default false,
  created_at timestamptz not null default now(),
  unique (survey_id, display_order),
  unique (survey_id, id)
);

create table public.position_task_demands (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.position_demand_surveys(id) on delete cascade,
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
  requires_collaboration boolean not null default false,
  collaboration_departments text[] not null default '{}',
  collaboration_positions text[] not null default '{}',
  handoff_content text,
  collaboration_problem text,
  collaboration_ai_support text,
  created_at timestamptz not null default now(),
  unique (survey_id, display_order),
  foreign key (survey_id, work_item_id) references public.position_work_items(survey_id, id) on delete cascade,
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

create index employee_assessments_user_id_idx on public.employee_assessments(user_id);
create index employee_assessments_batch_id_idx on public.employee_assessments(batch_id);
create index employee_assessments_survey_version_id_idx on public.employee_assessments(survey_version_id);
create index employee_task_demands_assessment_id_idx on public.employee_task_demands(assessment_id);
create index position_demand_surveys_user_id_idx on public.position_demand_surveys(user_id);
create index position_demand_surveys_batch_id_idx on public.position_demand_surveys(batch_id);
create index position_demand_surveys_survey_version_id_idx on public.position_demand_surveys(survey_version_id);
create index position_task_demands_survey_id_idx on public.position_task_demands(survey_id);
create index position_task_demands_survey_work_item_idx on public.position_task_demands(survey_id, work_item_id);

create trigger set_employee_assessments_updated_at
before update on public.employee_assessments
for each row execute function private.set_updated_at();

create trigger set_position_demand_surveys_updated_at
before update on public.position_demand_surveys
for each row execute function private.set_updated_at();
