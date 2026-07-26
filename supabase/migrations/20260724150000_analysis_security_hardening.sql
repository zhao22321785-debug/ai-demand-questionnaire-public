-- Forward-only hardening for analysis leases, quotas, and aggregate finalization.

alter table public.analysis_jobs
  add column lease_token uuid,
  add column lease_generation bigint not null default 0 check (lease_generation >= 0),
  add column last_manual_retry_at timestamptz;

alter table public.analysis_jobs
  add constraint analysis_jobs_error_code_length check (error_code is null or char_length(error_code) <= 64) not valid,
  add constraint analysis_jobs_error_summary_length check (error_summary is null or char_length(error_summary) <= 500) not valid;
alter table public.analysis_results
  add constraint analysis_results_error_code_length check (error_code is null or char_length(error_code) <= 64) not valid,
  add constraint analysis_results_error_summary_length check (error_summary is null or char_length(error_summary) <= 500) not valid;
alter table public.aggregate_analysis_runs
  add constraint aggregate_runs_error_code_length check (error_code is null or char_length(error_code) <= 64) not valid,
  add constraint aggregate_runs_error_summary_length check (error_summary is null or char_length(error_summary) <= 500) not valid;

create table private.analysis_admin_retry_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  job_id uuid not null references public.analysis_jobs(id) on delete restrict,
  window_date date not null,
  created_at timestamptz not null default now()
);

create index analysis_admin_retry_events_actor_window_idx
on private.analysis_admin_retry_events(actor_id, window_date, created_at);

revoke all on private.analysis_admin_retry_events from public, anon, authenticated, service_role;

create or replace function public.claim_analysis_job(
  p_job_id uuid,
  p_model_key text,
  p_prompt_version text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job public.analysis_jobs%rowtype;
  current_revision integer;
  saved_result public.analysis_results%rowtype;
begin
  select * into job from public.analysis_jobs where id = p_job_id;
  if not found then
    raise exception 'analysis job not found' using errcode = 'P0002';
  end if;

  if job.subject_type = 'employee_assessment' then
    select revision into current_revision from public.employee_assessments where id = job.subject_id for update;
  elsif job.subject_type = 'position_survey' then
    select revision into current_revision from public.position_demand_surveys where id = job.subject_id for update;
  else
    raise exception 'unsupported analysis subject type' using errcode = '22023';
  end if;

  select * into job from public.analysis_jobs where id = p_job_id for update;

  if current_revision is distinct from job.revision or job.status = 'stale' then
    update public.analysis_jobs
    set status = 'stale', next_retry_at = null, locked_at = null,
        lease_token = null, lease_generation = lease_generation + 1
    where id = job.id
    returning * into job;
    insert into public.analysis_results (
      job_id, subject_type, subject_id, revision, status, result_payload, evidence_index,
      attempt_count, error_code, error_summary, model_key, prompt_version
    ) values (
      job.id, job.subject_type, job.subject_id, job.revision, 'stale', null, '[]'::jsonb,
      job.attempt_count, null, null, p_model_key, p_prompt_version
    )
    on conflict (subject_type, subject_id, revision) do update
      set status = 'stale', result_payload = null, evidence_index = '[]'::jsonb,
          error_code = null, error_summary = null
    returning * into saved_result;
    return jsonb_build_object('kind', 'terminal', 'analysis', to_jsonb(saved_result));
  end if;

  if job.status <> 'queued' or (job.next_retry_at is not null and job.next_retry_at > now()) then
    select * into saved_result from public.analysis_results where job_id = job.id;
    return jsonb_build_object(
      'kind',
      case job.status when 'complete' then 'already_complete' when 'running' then 'already_running' else 'terminal' end,
      'analysis', to_jsonb(saved_result)
    );
  end if;

  update public.analysis_jobs
  set status = 'running', locked_at = now(), next_retry_at = null,
      lease_token = gen_random_uuid(), lease_generation = lease_generation + 1
  where id = job.id
  returning * into job;

  insert into public.analysis_results (
    job_id, subject_type, subject_id, revision, status, result_payload, evidence_index,
    attempt_count, error_code, error_summary, model_key, prompt_version
  ) values (
    job.id, job.subject_type, job.subject_id, job.revision, 'running', null, '[]'::jsonb,
    job.attempt_count, null, null, p_model_key, p_prompt_version
  )
  on conflict (subject_type, subject_id, revision) do update set
    job_id = excluded.job_id,
    status = 'running',
    result_payload = null,
    evidence_index = '[]'::jsonb,
    attempt_count = job.attempt_count,
    error_code = null,
    error_summary = null,
    model_key = excluded.model_key,
    prompt_version = excluded.prompt_version
  returning * into saved_result;

  return jsonb_build_object(
    'kind', 'claimed',
    'jobId', job.id,
    'leaseToken', job.lease_token,
    'leaseGeneration', job.lease_generation,
    'attemptCount', job.attempt_count
  );
end;
$$;

create or replace function public.record_analysis_job_attempt(
  p_job_id uuid,
  p_lease_token uuid,
  p_attempt_count integer,
  p_error_code text,
  p_error_summary text,
  p_next_retry_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job public.analysis_jobs%rowtype;
  saved_result public.analysis_results%rowtype;
  next_status text;
begin
  if p_attempt_count not between 1 and 3
    or p_error_code is not null and char_length(p_error_code) > 64
    or p_error_summary is not null and char_length(p_error_summary) > 500
  then
    raise exception 'invalid analysis attempt payload' using errcode = '22023';
  end if;

  select * into job from public.analysis_jobs where id = p_job_id for update;
  if not found then raise exception 'analysis job not found' using errcode = 'P0002'; end if;
  if job.status <> 'running' or job.lease_token is distinct from p_lease_token then
    raise exception 'analysis lease is no longer current' using errcode = '55000';
  end if;
  if p_attempt_count < job.attempt_count or p_attempt_count > job.attempt_count + 1 then
    raise exception 'invalid analysis attempt sequence' using errcode = '22023';
  end if;

  next_status := case when p_next_retry_at is null then 'running' else 'queued' end;
  update public.analysis_jobs
  set status = next_status,
      attempt_count = p_attempt_count,
      error_code = p_error_code,
      error_summary = p_error_summary,
      next_retry_at = p_next_retry_at,
      locked_at = case when next_status = 'queued' then null else locked_at end,
      lease_token = case when next_status = 'queued' then null else lease_token end,
      lease_generation = case when next_status = 'queued' then lease_generation + 1 else lease_generation end
  where id = job.id;

  update public.analysis_results
  set status = next_status,
      attempt_count = p_attempt_count,
      error_code = p_error_code,
      error_summary = p_error_summary
  where job_id = job.id
  returning * into saved_result;
  if not found then raise exception 'analysis result not found' using errcode = 'P0002'; end if;
  return to_jsonb(saved_result);
end;
$$;

drop function public.finalize_analysis_job(uuid, text, jsonb, jsonb, integer, text, text);

create or replace function public.finalize_analysis_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_terminal_status text,
  p_result_payload jsonb,
  p_evidence_index jsonb,
  p_attempt_count integer,
  p_error_code text,
  p_error_summary text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job public.analysis_jobs%rowtype;
  current_revision integer;
  current_batch_id uuid;
  final_status text;
  saved_result public.analysis_results%rowtype;
begin
  if p_terminal_status not in ('complete', 'failed', 'stale')
    or p_attempt_count not between 0 and 3
    or jsonb_typeof(coalesce(p_evidence_index, '[]'::jsonb)) <> 'array'
    or p_error_code is not null and char_length(p_error_code) > 64
    or p_error_summary is not null and char_length(p_error_summary) > 500
  then
    raise exception 'invalid analysis finalization payload' using errcode = '22023';
  end if;

  select * into job from public.analysis_jobs where id = p_job_id;
  if not found then raise exception 'analysis job not found' using errcode = 'P0002'; end if;

  if job.subject_type = 'employee_assessment' then
    select revision, batch_id into current_revision, current_batch_id
    from public.employee_assessments where id = job.subject_id for update;
  elsif job.subject_type = 'position_survey' then
    select revision, batch_id into current_revision, current_batch_id
    from public.position_demand_surveys where id = job.subject_id for update;
  else
    raise exception 'unsupported analysis subject type' using errcode = '22023';
  end if;

  select * into job from public.analysis_jobs where id = p_job_id for update;
  if job.status = 'stale' then
    select * into saved_result from public.analysis_results where job_id = job.id;
    return to_jsonb(saved_result);
  end if;
  if job.status <> 'running' or job.lease_token is distinct from p_lease_token then
    raise exception 'analysis lease is no longer current' using errcode = '55000';
  end if;

  final_status := case
    when current_revision is distinct from job.revision or p_terminal_status = 'stale' then 'stale'
    else p_terminal_status
  end;

  update public.analysis_jobs
  set status = final_status,
      attempt_count = greatest(attempt_count, p_attempt_count),
      next_retry_at = null,
      locked_at = null,
      lease_token = null,
      lease_generation = lease_generation + 1,
      error_code = case when final_status = 'failed' then p_error_code else null end,
      error_summary = case when final_status = 'failed' then p_error_summary else null end
  where id = job.id;

  update public.analysis_results
  set status = final_status,
      result_payload = case when final_status = 'complete' then p_result_payload else null end,
      evidence_index = case when final_status = 'complete' then p_evidence_index else '[]'::jsonb end,
      attempt_count = greatest(attempt_count, p_attempt_count),
      error_code = case when final_status = 'failed' then p_error_code else null end,
      error_summary = case when final_status = 'failed' then p_error_summary else null end
  where job_id = job.id
  returning * into saved_result;
  if not found then raise exception 'analysis result not found' using errcode = 'P0002'; end if;

  if current_revision = job.revision then
    if job.subject_type = 'employee_assessment' then
      update public.employee_assessments set analysis_status = final_status where id = job.subject_id and revision = job.revision;
    else
      update public.position_demand_surveys set analysis_status = final_status where id = job.subject_id and revision = job.revision;
    end if;
    update public.aggregate_analysis_runs set status = 'stale'
    where batch_id = current_batch_id and status = 'complete';
  end if;

  return to_jsonb(saved_result);
end;
$$;

create or replace function public.requeue_stalled_analysis_jobs(
  p_stalled_before timestamptz,
  p_limit integer
)
returns table(subject_type text, subject_id uuid, revision integer)
language sql
security invoker
set search_path = ''
as $$
  with stalled as (
    select id
    from public.analysis_jobs
    where status = 'running' and locked_at < p_stalled_before
    order by locked_at, id
    for update skip locked
    limit least(greatest(p_limit, 1), 20)
  ), reset_jobs as (
    update public.analysis_jobs jobs
    set status = 'queued', locked_at = null, next_retry_at = null,
        lease_token = null, lease_generation = lease_generation + 1
    from stalled
    where jobs.id = stalled.id and jobs.status = 'running'
    returning jobs.id, jobs.subject_type, jobs.subject_id, jobs.revision
  ), reset_results as (
    update public.analysis_results results
    set status = 'queued'
    from reset_jobs
    where results.job_id = reset_jobs.id
    returning results.job_id
  )
  select reset_jobs.subject_type, reset_jobs.subject_id, reset_jobs.revision
  from reset_jobs;
$$;

create or replace function public.enqueue_analysis_job_with_quota(
  p_subject_type text,
  p_subject_id uuid,
  p_revision integer,
  p_actor_id uuid,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_job public.analysis_jobs%rowtype;
  daily_count integer;
  saved_job public.analysis_jobs%rowtype;
begin
  if p_subject_type not in ('employee_assessment', 'position_survey') or p_revision < 1 or p_daily_limit not between 1 and 100 then
    raise exception 'invalid analysis enqueue payload' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || ':analysis:' || current_date::text, 0));
  select * into existing_job from public.analysis_jobs
  where subject_type = p_subject_type and subject_id = p_subject_id and revision = p_revision;
  if found then return jsonb_build_object('kind', 'existing', 'jobId', existing_job.id); end if;

  select count(*) into daily_count from public.analysis_jobs
  where requested_by = p_actor_id and created_at >= date_trunc('day', now());
  if daily_count >= p_daily_limit then return jsonb_build_object('kind', 'quota_exceeded'); end if;

  insert into public.analysis_jobs(subject_type, subject_id, revision, status, requested_by)
  values (p_subject_type, p_subject_id, p_revision, 'queued', p_actor_id)
  returning * into saved_job;
  return jsonb_build_object('kind', 'queued', 'jobId', saved_job.id);
end;
$$;

create or replace function private.consume_analysis_admin_retry_quota(
  p_actor_id uuid,
  p_job_id uuid,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry_count integer;
  retry_after_seconds integer;
begin
  if p_daily_limit not between 1 and 100 then
    raise exception 'invalid admin retry quota' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.user_roles role
    where role.user_id = p_actor_id and role.role = 'admin' and role.status = 'active'
  ) then
    raise exception 'active admin required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('analysis-admin-retry:' || p_actor_id::text || ':' || current_date::text, 0));
  select count(*) into retry_count
  from private.analysis_admin_retry_events event
  where event.actor_id = p_actor_id and event.window_date = current_date;

  if retry_count >= p_daily_limit then
    retry_after_seconds := greatest(1, ceil(extract(epoch from (date_trunc('day', now()) + interval '1 day' - now())))::integer);
    return jsonb_build_object('kind', 'quota_exceeded', 'retryAfterSeconds', retry_after_seconds);
  end if;

  insert into private.analysis_admin_retry_events(actor_id, job_id, window_date)
  values (p_actor_id, p_job_id, current_date);
  return jsonb_build_object('kind', 'consumed');
end;
$$;

revoke all on function private.consume_analysis_admin_retry_quota(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.consume_analysis_admin_retry_quota(uuid, uuid, integer) to service_role;

create or replace function public.queue_analysis_retry_with_throttle(
  p_subject_type text,
  p_subject_id uuid,
  p_revision integer,
  p_actor_id uuid,
  p_cooldown_seconds integer,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job public.analysis_jobs%rowtype;
  quota_result jsonb;
  retry_after_seconds integer;
begin
  if p_cooldown_seconds not between 30 and 86400 or p_daily_limit not between 1 and 100 then
    raise exception 'invalid retry throttle' using errcode = '22023';
  end if;
  select * into job from public.analysis_jobs
  where subject_type = p_subject_type and subject_id = p_subject_id and revision = p_revision
  for update;
  if not found or job.status not in ('failed', 'stale') then return jsonb_build_object('kind', 'not_retryable'); end if;
  if job.last_manual_retry_at is not null and job.last_manual_retry_at > now() - make_interval(secs => p_cooldown_seconds) then
    retry_after_seconds := greatest(1, ceil(extract(epoch from (job.last_manual_retry_at + make_interval(secs => p_cooldown_seconds) - now())))::integer);
    return jsonb_build_object('kind', 'throttled', 'retryAfterSeconds', retry_after_seconds);
  end if;
  quota_result := private.consume_analysis_admin_retry_quota(p_actor_id, job.id, p_daily_limit);
  if quota_result ->> 'kind' <> 'consumed' then return quota_result; end if;
  update public.analysis_jobs
  set status = 'queued', attempt_count = 0, manual_retry_count = manual_retry_count + 1,
      locked_at = null, next_retry_at = null,
      lease_token = null, lease_generation = lease_generation + 1,
      last_manual_retry_at = now(), error_code = null, error_summary = null
  where id = job.id;
  update public.analysis_results
  set status = 'queued', result_payload = null, evidence_index = '[]'::jsonb,
      attempt_count = 0, error_code = null, error_summary = null
  where job_id = job.id;
  return jsonb_build_object('kind', 'queued', 'jobId', job.id);
end;
$$;

create or replace function public.finalize_aggregate_analysis_run(
  p_run_id uuid,
  p_expected_snapshot jsonb,
  p_terminal_status text,
  p_result_payload jsonb,
  p_error_code text,
  p_error_summary text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  run public.aggregate_analysis_runs%rowtype;
  run_batch_id uuid;
  current_snapshot jsonb;
  final_status text;
begin
  if p_terminal_status not in ('complete', 'failed')
    or jsonb_typeof(p_expected_snapshot) <> 'array'
    or p_error_code is not null and char_length(p_error_code) > 64
    or p_error_summary is not null and char_length(p_error_summary) > 500
  then
    raise exception 'invalid aggregate finalization payload' using errcode = '22023';
  end if;

  select batch_id into run_batch_id from public.aggregate_analysis_runs where id = p_run_id;
  if not found then raise exception 'aggregate run not found' using errcode = 'P0002'; end if;

  perform 1 from public.employee_assessments where batch_id = run_batch_id order by id for share;
  perform 1 from public.position_demand_surveys where batch_id = run_batch_id order by id for share;
  perform 1 from public.analysis_results result
  where result.status = 'complete' and (
    exists (select 1 from public.employee_assessments employee
      where employee.batch_id = run_batch_id and employee.id = result.subject_id
        and result.subject_type = 'employee_assessment' and employee.revision = result.revision)
    or exists (select 1 from public.position_demand_surveys position
      where position.batch_id = run_batch_id and position.id = result.subject_id
        and result.subject_type = 'position_survey' and position.revision = result.revision)
  ) order by result.subject_type, result.subject_id for share;

  select * into run from public.aggregate_analysis_runs where id = p_run_id for update;
  if run.status <> 'running' then
    return jsonb_build_object('status', run.status, 'finalized', false);
  end if;

  select jsonb_build_array(jsonb_build_object(
      'ruleVersion', run.rule_version,
      'promptVersion', run.prompt_version,
      'modelKey', run.model_key,
      'minSampleSize', run.min_sample_size
    )) || coalesce(jsonb_agg(jsonb_build_object(
      'analysisResultId', source.id,
      'subjectType', source.subject_type,
      'subjectId', source.subject_id,
      'revision', source.revision,
      'updatedAt', source.updated_at
    ) order by source.subject_type, source.subject_id), '[]'::jsonb)
  into current_snapshot
  from (
    select result.id, result.subject_type, result.subject_id, result.revision, result.updated_at
    from public.analysis_results result
    join public.employee_assessments employee
      on result.subject_type = 'employee_assessment' and employee.id = result.subject_id and employee.revision = result.revision
    where result.status = 'complete' and employee.batch_id = run.batch_id
    union all
    select result.id, result.subject_type, result.subject_id, result.revision, result.updated_at
    from public.analysis_results result
    join public.position_demand_surveys position
      on result.subject_type = 'position_survey' and position.id = result.subject_id and position.revision = result.revision
    where result.status = 'complete' and position.batch_id = run.batch_id
  ) source;

  if run.source_snapshot is distinct from p_expected_snapshot or current_snapshot is distinct from p_expected_snapshot then
    final_status := 'stale';
  else
    final_status := p_terminal_status;
  end if;

  update public.aggregate_analysis_runs
  set status = final_status,
      result_payload = case when final_status = 'complete' then p_result_payload else null end,
      error_code = case when final_status = 'failed' then p_error_code else null end,
      error_summary = case when final_status = 'failed' then p_error_summary else null end
  where id = run.id and status = 'running';

  return jsonb_build_object('status', final_status, 'finalized', final_status in ('complete', 'failed'));
end;
$$;

revoke all on function public.claim_analysis_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_analysis_job_attempt(uuid, uuid, integer, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_analysis_job(uuid, uuid, text, jsonb, jsonb, integer, text, text) from public, anon, authenticated;
revoke all on function public.requeue_stalled_analysis_jobs(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.enqueue_analysis_job_with_quota(text, uuid, integer, uuid, integer) from public, anon, authenticated;
revoke all on function public.queue_analysis_retry_with_throttle(text, uuid, integer, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_aggregate_analysis_run(uuid, jsonb, text, jsonb, text, text) from public, anon, authenticated;

grant execute on function public.claim_analysis_job(uuid, text, text) to service_role;
grant execute on function public.record_analysis_job_attempt(uuid, uuid, integer, text, text, timestamptz) to service_role;
grant execute on function public.finalize_analysis_job(uuid, uuid, text, jsonb, jsonb, integer, text, text) to service_role;
grant execute on function public.requeue_stalled_analysis_jobs(timestamptz, integer) to service_role;
grant execute on function public.enqueue_analysis_job_with_quota(text, uuid, integer, uuid, integer) to service_role;
grant execute on function public.queue_analysis_retry_with_throttle(text, uuid, integer, uuid, integer, integer) to service_role;
grant execute on function public.finalize_aggregate_analysis_run(uuid, jsonb, text, jsonb, text, text) to service_role;
