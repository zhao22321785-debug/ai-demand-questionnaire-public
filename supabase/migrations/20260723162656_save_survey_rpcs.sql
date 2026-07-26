create or replace function private.jsonb_text_array(value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(item), '{}'::text[])
  from jsonb_array_elements_text(coalesce(value, '[]'::jsonb)) as item;
$$;

revoke all on function private.jsonb_text_array(jsonb) from public, anon, authenticated;

create or replace function private.jsonb_uuid_array(value jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(item::uuid), '{}'::uuid[])
  from jsonb_array_elements_text(coalesce(value, '[]'::jsonb)) as item;
$$;

revoke all on function private.jsonb_uuid_array(jsonb) from public, anon, authenticated;

create or replace function private.save_employee_assessment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  saved_assessment_id uuid;
  assessment_revision integer;
  task_count integer;
  has_demand boolean;
  task_record record;
  task_id uuid;
  dimensions jsonb;
  employee_status text;
  non_use_reason_values text[];
  discontinuation_reason_values text[];
  tool_id_values uuid[];
  scenario_values text[];
  pain_point_values text[];
  department_id_value uuid;
  department_other_value text;
  position_id_value uuid;
  position_other_value text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'invalid employee survey payload' using errcode = '22023';
  end if;

  if pg_column_size(payload) > 131072 then
    raise exception 'employee survey payload is too large' using errcode = '22023';
  end if;

  if not private.is_active_user() then
    raise exception 'active user required' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(payload -> 'tasks', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(payload -> 'nonUseReasons', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(payload -> 'discontinuationReasons', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(payload -> 'aiToolIds', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(payload -> 'aiScenarios', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(payload -> 'painPoints', '[]'::jsonb)) <> 'array'
  then
    raise exception 'employee survey list fields must be arrays' using errcode = '22023';
  end if;

  employee_status := payload ->> 'aiUseStatus';
  non_use_reason_values := private.jsonb_text_array(payload -> 'nonUseReasons');
  discontinuation_reason_values := private.jsonb_text_array(payload -> 'discontinuationReasons');
  tool_id_values := private.jsonb_uuid_array(payload -> 'aiToolIds');
  scenario_values := private.jsonb_text_array(payload -> 'aiScenarios');
  pain_point_values := private.jsonb_text_array(payload -> 'painPoints');
  department_id_value := nullif(payload #>> '{profile,departmentId}', '')::uuid;
  department_other_value := nullif(btrim(payload #>> '{profile,departmentOther}'), '');
  position_id_value := nullif(payload #>> '{profile,positionId}', '')::uuid;
  position_other_value := nullif(btrim(payload #>> '{profile,positionOther}'), '');

  if nullif(btrim(payload #>> '{profile,name}'), '') is null
    or payload #>> '{profile,currentPositionExperience}' not in ('under_1', '1_3', '3_5', '5_10', 'over_10')
    or ((department_id_value is null) = (department_other_value is null))
    or ((position_id_value is null) = (position_other_value is null))
  then
    raise exception 'employee profile is invalid' using errcode = '22023';
  end if;

  if (department_id_value is not null and not exists (
    select 1 from public.departments where id = department_id_value and is_active
  )) or (position_id_value is not null and not exists (
    select 1 from public.positions where id = position_id_value and is_active
  )) then
    raise exception 'employee profile reference is inactive or missing' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.survey_batches batch
    join public.survey_versions version
      on version.id = batch.employee_survey_version_id
      and version.survey_type = 'employee'
      and version.status = 'active'
    where batch.id = (payload ->> 'batchId')::uuid
      and batch.employee_survey_version_id = (payload ->> 'surveyVersionId')::uuid
      and batch.status = 'active'
      and (batch.starts_at is null or now() >= batch.starts_at)
      and (batch.ends_at is null or now() < batch.ends_at)
  ) then
    raise exception 'active employee survey batch not found' using errcode = '22023';
  end if;

  task_count := jsonb_array_length(coalesce(payload -> 'tasks', '[]'::jsonb));
  has_demand := coalesce((payload ->> 'hasExplicitDemand')::boolean, false);
  if task_count > 3 or (has_demand and task_count < 1) or (not has_demand and task_count <> 0) then
    raise exception 'employee task count does not match demand state' using errcode = '22023';
  end if;

  dimensions := coalesce(payload -> 'dimensions', '[null,null,null,null,null,null]'::jsonb);
  if not private.is_valid_dimension_answers(dimensions)
    or jsonb_typeof(dimensions -> 0) <> 'number'
    or (employee_status = 'never' and dimensions <> jsonb_build_array(dimensions -> 0, null, null, null, null, null))
    or (employee_status <> 'never' and exists (
      select 1 from jsonb_array_elements(dimensions) as answer(item)
      where jsonb_typeof(answer.item) <> 'number'
    ))
  then
    raise exception 'employee dimensions do not match the usage state' using errcode = '22023';
  end if;

  if cardinality(scenario_values) > 3 or cardinality(pain_point_values) > 3 then
    raise exception 'employee survey selections exceed the allowed maximum' using errcode = '22023';
  end if;

  if employee_status = 'never' then
    if cardinality(non_use_reason_values) = 0
      or cardinality(discontinuation_reason_values) <> 0
      or cardinality(tool_id_values) <> 0
      or nullif(btrim(payload ->> 'aiToolOther'), '') is not null
      or cardinality(scenario_values) <> 0
    then
      raise exception 'employee non-use details are invalid' using errcode = '22023';
    end if;
  elsif employee_status in ('frequent', 'sometimes', 'tried_rarely') then
    if cardinality(non_use_reason_values) <> 0
      or (cardinality(tool_id_values) = 0 and nullif(btrim(payload ->> 'aiToolOther'), '') is null)
      or cardinality(scenario_values) not between 1 and 3
      or (employee_status = 'tried_rarely' and cardinality(discontinuation_reason_values) = 0)
      or (employee_status <> 'tried_rarely' and cardinality(discontinuation_reason_values) <> 0)
    then
      raise exception 'employee AI-use details are invalid' using errcode = '22023';
    end if;
  else
    raise exception 'employee AI-use status is invalid' using errcode = '22023';
  end if;

  if cardinality(tool_id_values) <> (
    select count(distinct tool_id) from unnest(tool_id_values) as tool_id
  ) or exists (
    select 1
    from unnest(tool_id_values) as tool_id
    left join public.ai_tool_options option
      on option.id = tool_id
      and option.is_active
      and option.code <> 'other'
    where option.id is null
  ) then
    raise exception 'employee AI tool reference is inactive, missing, or duplicated' using errcode = '22023';
  end if;

  insert into public.user_profiles (
    user_id,
    name,
    department_id,
    department_other,
    position_id,
    position_other,
    current_position_experience
  ) values (
    current_user_id,
    nullif(btrim(payload #>> '{profile,name}'), ''),
    department_id_value,
    department_other_value,
    position_id_value,
    position_other_value,
    payload #>> '{profile,currentPositionExperience}'
  )
  on conflict (user_id) do update set
    name = excluded.name,
    department_id = excluded.department_id,
    department_other = excluded.department_other,
    position_id = excluded.position_id,
    position_other = excluded.position_other,
    current_position_experience = excluded.current_position_experience;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || (payload ->> 'batchId'), 0));

  insert into public.employee_assessments (
    batch_id,
    user_id,
    survey_version_id,
    ai_use_status,
    non_use_reasons,
    discontinuation_reasons,
    ai_tool_ids,
    ai_tool_other,
    ai_scenarios,
    pain_points,
    has_explicit_demand,
    dimension_answers,
    response_payload,
    revision,
    analysis_status,
    submitted_at
  ) values (
    (payload ->> 'batchId')::uuid,
    current_user_id,
    (payload ->> 'surveyVersionId')::uuid,
    employee_status,
    non_use_reason_values,
    discontinuation_reason_values,
    tool_id_values,
    nullif(btrim(payload ->> 'aiToolOther'), ''),
    scenario_values,
    pain_point_values,
    has_demand,
    dimensions,
    payload,
    1,
    'pending',
    now()
  )
  on conflict (batch_id, user_id) do update set
    survey_version_id = excluded.survey_version_id,
    ai_use_status = excluded.ai_use_status,
    non_use_reasons = excluded.non_use_reasons,
    discontinuation_reasons = excluded.discontinuation_reasons,
    ai_tool_ids = excluded.ai_tool_ids,
    ai_tool_other = excluded.ai_tool_other,
    ai_scenarios = excluded.ai_scenarios,
    pain_points = excluded.pain_points,
    has_explicit_demand = excluded.has_explicit_demand,
    dimension_answers = excluded.dimension_answers,
    response_payload = excluded.response_payload,
    revision = public.employee_assessments.revision + 1,
    analysis_status = 'pending',
    submitted_at = now()
  returning id, revision into saved_assessment_id, assessment_revision;

  delete from public.employee_task_demands
  where public.employee_task_demands.assessment_id = saved_assessment_id;

  for task_record in
    select item, ordinality
    from jsonb_array_elements(coalesce(payload -> 'tasks', '[]'::jsonb)) with ordinality as tasks(item, ordinality)
  loop
    if employee_status = 'never' and task_record.item ->> 'aiUseStatus' <> 'never' then
      raise exception 'employee task AI status conflicts with the parent survey' using errcode = '22023';
    end if;

    task_id := case
      when nullif(task_record.item ->> 'id', '') is null then gen_random_uuid()
      else (task_record.item ->> 'id')::uuid
    end;

    insert into public.employee_task_demands (
      id,
      assessment_id,
      display_order,
      title,
      current_process,
      main_problem,
      occurrence,
      stability,
      audience,
      ai_use_status,
      ai_follow_up,
      expected_support
    ) values (
      task_id,
      saved_assessment_id,
      task_record.ordinality,
      task_record.item ->> 'title',
      task_record.item ->> 'currentProcess',
      task_record.item ->> 'mainProblem',
      task_record.item ->> 'occurrence',
      task_record.item ->> 'stability',
      task_record.item ->> 'audience',
      task_record.item ->> 'aiUseStatus',
      nullif(btrim(task_record.item ->> 'aiFollowUp'), ''),
      task_record.item ->> 'expectedSupport'
    );
  end loop;

  return jsonb_build_object(
    'id', saved_assessment_id,
    'revision', assessment_revision,
    'analysisStatus', 'pending'
  );
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

create or replace function private.save_position_survey(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  saved_survey_id uuid;
  survey_revision integer;
  position_key_value text;
  work_items jsonb := coalesce(payload -> 'workItems', '[]'::jsonb);
  tasks jsonb := coalesce(payload -> 'taskDemands', '[]'::jsonb);
  work_item_count integer;
  selected_count integer;
  task_count integer;
  item_record record;
  task_record record;
  task_id uuid;
  department_id_value uuid;
  department_other_value text;
  position_id_value uuid;
  position_other_value text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'invalid position survey payload' using errcode = '22023';
  end if;

  if pg_column_size(payload) > 131072 then
    raise exception 'position survey payload is too large' using errcode = '22023';
  end if;

  if not private.is_active_user() then
    raise exception 'active user required' using errcode = '42501';
  end if;

  if jsonb_typeof(work_items) <> 'array' or jsonb_typeof(tasks) <> 'array' then
    raise exception 'position survey work items and tasks must be arrays' using errcode = '22023';
  end if;

  department_id_value := nullif(payload ->> 'departmentId', '')::uuid;
  department_other_value := nullif(btrim(payload ->> 'departmentOther'), '');
  position_id_value := nullif(payload ->> 'positionId', '')::uuid;
  position_other_value := nullif(btrim(payload ->> 'positionOther'), '');

  if nullif(btrim(payload ->> 'researcherName'), '') is null
    or nullif(btrim(payload ->> 'positionName'), '') is null
    or payload ->> 'relatedPositionExperience' not in ('under_1', '1_3', '3_5', '5_10', 'over_10')
    or ((department_id_value is null) = (department_other_value is null))
    or ((position_id_value is null) = (position_other_value is null))
  then
    raise exception 'position survey identity is invalid' using errcode = '22023';
  end if;

  if (department_id_value is not null and not exists (
    select 1 from public.departments where id = department_id_value and is_active
  )) or (position_id_value is not null and not exists (
    select 1 from public.positions where id = position_id_value and is_active
  )) then
    raise exception 'position survey reference is inactive or missing' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.survey_batches batch
    join public.survey_versions version
      on version.id = batch.position_survey_version_id
      and version.survey_type = 'position'
      and version.status = 'active'
    where batch.id = (payload ->> 'batchId')::uuid
      and batch.position_survey_version_id = (payload ->> 'surveyVersionId')::uuid
      and batch.status = 'active'
      and (batch.starts_at is null or now() >= batch.starts_at)
      and (batch.ends_at is null or now() < batch.ends_at)
  ) then
    raise exception 'active position survey batch not found' using errcode = '22023';
  end if;

  work_item_count := jsonb_array_length(work_items);
  task_count := jsonb_array_length(tasks);
  select count(*) into selected_count
  from jsonb_array_elements(work_items) as item
  where coalesce((item ->> 'selectedForImprovement')::boolean, false);

  if work_item_count not between 2 and 5 or selected_count not between 1 and 3 or task_count not between 1 and 3 then
    raise exception 'position survey item counts are invalid' using errcode = '22023';
  end if;

  if position_id_value is not null then
    position_key_value := 'std:' || position_id_value::text;
  else
    position_key_value := 'other:' || lower(regexp_replace(btrim(payload ->> 'positionName'), '\s+', ' ', 'g'));
  end if;

  if position_key_value = 'other:' then
    raise exception 'position name is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || (payload ->> 'batchId') || ':' || position_key_value, 0));

  insert into public.position_demand_surveys (
    batch_id,
    user_id,
    survey_version_id,
    researcher_name,
    department_id,
    department_other,
    position_id,
    position_other,
    position_key,
    position_name,
    related_position_experience,
    response_payload,
    revision,
    analysis_status,
    submitted_at
  ) values (
    (payload ->> 'batchId')::uuid,
    current_user_id,
    (payload ->> 'surveyVersionId')::uuid,
    payload ->> 'researcherName',
    department_id_value,
    department_other_value,
    position_id_value,
    position_other_value,
    position_key_value,
    payload ->> 'positionName',
    payload ->> 'relatedPositionExperience',
    payload,
    1,
    'pending',
    now()
  )
  on conflict (batch_id, user_id, position_key) do update set
    survey_version_id = excluded.survey_version_id,
    researcher_name = excluded.researcher_name,
    department_id = excluded.department_id,
    department_other = excluded.department_other,
    position_id = excluded.position_id,
    position_other = excluded.position_other,
    position_name = excluded.position_name,
    related_position_experience = excluded.related_position_experience,
    response_payload = excluded.response_payload,
    revision = public.position_demand_surveys.revision + 1,
    analysis_status = 'pending',
    submitted_at = now()
  returning id, revision into saved_survey_id, survey_revision;

  delete from public.position_work_items
  where public.position_work_items.survey_id = saved_survey_id;

  for item_record in
    select item, ordinality
    from jsonb_array_elements(work_items) with ordinality as items(item, ordinality)
  loop
    insert into public.position_work_items (
      id,
      survey_id,
      display_order,
      name,
      description,
      selected_for_improvement
    ) values (
      (item_record.item ->> 'id')::uuid,
      saved_survey_id,
      item_record.ordinality,
      item_record.item ->> 'name',
      item_record.item ->> 'description',
      coalesce((item_record.item ->> 'selectedForImprovement')::boolean, false)
    );
  end loop;

  for task_record in
    select item, ordinality
    from jsonb_array_elements(tasks) with ordinality as task_rows(item, ordinality)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(work_items) as item
      where item ->> 'id' = task_record.item ->> 'workItemId'
        and coalesce((item ->> 'selectedForImprovement')::boolean, false)
    ) then
      raise exception 'position task must reference a selected work item' using errcode = '22023';
    end if;

    task_id := case
      when nullif(task_record.item ->> 'id', '') is null then gen_random_uuid()
      else (task_record.item ->> 'id')::uuid
    end;

    insert into public.position_task_demands (
      id,
      survey_id,
      work_item_id,
      display_order,
      task,
      common_input,
      has_fixed_input,
      output,
      has_fixed_output,
      current_process,
      main_problem,
      occurrence,
      stability,
      audience,
      ai_participation,
      expected_ai_support,
      result_usage,
      human_review_content,
      requires_collaboration,
      collaboration_departments,
      collaboration_positions,
      handoff_content,
      collaboration_problem,
      collaboration_ai_support
    ) values (
      task_id,
      saved_survey_id,
      (task_record.item ->> 'workItemId')::uuid,
      task_record.ordinality,
      task_record.item ->> 'task',
      coalesce(task_record.item ->> 'commonInput', ''),
      coalesce((task_record.item ->> 'hasFixedInput')::boolean, false),
      coalesce(task_record.item ->> 'output', ''),
      coalesce((task_record.item ->> 'hasFixedOutput')::boolean, false),
      task_record.item ->> 'currentProcess',
      task_record.item ->> 'mainProblem',
      task_record.item ->> 'occurrence',
      task_record.item ->> 'stability',
      task_record.item ->> 'audience',
      task_record.item ->> 'aiParticipation',
      task_record.item ->> 'expectedAiSupport',
      task_record.item ->> 'resultUsage',
      nullif(btrim(task_record.item ->> 'humanReviewContent'), ''),
      coalesce((task_record.item ->> 'requiresCollaboration')::boolean, false),
      private.jsonb_text_array(task_record.item -> 'collaborationDepartments'),
      private.jsonb_text_array(task_record.item -> 'collaborationPositions'),
      nullif(btrim(task_record.item ->> 'handoffContent'), ''),
      nullif(btrim(task_record.item ->> 'collaborationProblem'), ''),
      nullif(btrim(task_record.item ->> 'collaborationAiSupport'), '')
    );
  end loop;

  return jsonb_build_object(
    'id', saved_survey_id,
    'revision', survey_revision,
    'analysisStatus', 'pending'
  );
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
