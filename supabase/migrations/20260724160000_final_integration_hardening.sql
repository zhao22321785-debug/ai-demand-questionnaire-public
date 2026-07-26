-- Forward-only hardening for durable analysis admission, active-batch
-- singleton enforcement, and save-time analysis job creation.

do $$
begin
  if (select count(*) from public.survey_batches where status = 'active') > 1 then
    raise exception 'more than one active survey batch; resolve the duplicate before this migration';
  end if;
end;
$$;

create unique index survey_batches_single_active_idx
on public.survey_batches ((status))
where status = 'active';

create or replace function private.activate_survey_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch public.survey_batches%rowtype;
  employee_version_status text;
  position_version_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('survey-batches:active', 0));

  select * into target_batch
  from public.survey_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'survey batch not found' using errcode = 'P0002';
  end if;
  if target_batch.status <> 'draft' then
    raise exception 'target survey batch must be draft' using errcode = '55000';
  end if;
  if target_batch.ends_at is not null and target_batch.ends_at <= now() then
    raise exception 'target survey batch window has ended' using errcode = '22023';
  end if;

  select status into employee_version_status
  from public.survey_versions
  where id = target_batch.employee_survey_version_id and survey_type = 'employee'
  for share;
  select status into position_version_status
  from public.survey_versions
  where id = target_batch.position_survey_version_id and survey_type = 'position'
  for share;

  if employee_version_status is distinct from 'active' or position_version_status is distinct from 'active' then
    raise exception 'target survey batch versions must both be active' using errcode = '22023';
  end if;

  update public.survey_batches
  set status = 'closed'
  where status = 'active' and id <> target_batch.id;

  update public.survey_batches
  set status = 'active', starts_at = coalesce(starts_at, now())
  where id = target_batch.id and status = 'draft'
  returning * into target_batch;

  if not found then
    raise exception 'target survey batch changed during activation' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'id', target_batch.id,
    'status', target_batch.status,
    'startsAt', target_batch.starts_at
  );
end;
$$;

revoke all on function private.activate_survey_batch(uuid) from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.activate_survey_batch(uuid) to service_role;

create or replace function public.activate_survey_batch(p_batch_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.activate_survey_batch(p_batch_id);
$$;

revoke all on function public.activate_survey_batch(uuid) from public, anon, authenticated, service_role;
grant execute on function public.activate_survey_batch(uuid) to service_role;

alter function private.save_employee_assessment(jsonb)
rename to save_employee_assessment_without_analysis_job;

revoke all on function private.save_employee_assessment_without_analysis_job(jsonb)
from public, anon, authenticated, service_role;

create or replace function private.save_employee_assessment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  saved_result jsonb;
begin
  saved_result := private.save_employee_assessment_without_analysis_job(payload);

  insert into public.analysis_jobs (
    subject_type, subject_id, revision, status, requested_by
  ) values (
    'employee_assessment',
    (saved_result ->> 'id')::uuid,
    (saved_result ->> 'revision')::integer,
    'queued',
    current_user_id
  )
  on conflict (subject_type, subject_id, revision) do nothing;

  return saved_result;
end;
$$;

revoke all on function private.save_employee_assessment(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.save_employee_assessment(jsonb) to authenticated;

-- Rebind the exposed RPC explicitly after replacing the private implementation.
-- The existing SQL-string wrapper resolves names at execution time, but keeping
-- this definition in the same migration makes the durable-job path auditable.
create or replace function public.save_employee_assessment(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_employee_assessment(payload);
$$;

revoke all on function public.save_employee_assessment(jsonb) from public, anon, service_role;
grant execute on function public.save_employee_assessment(jsonb) to authenticated;

alter function private.save_position_survey(jsonb)
rename to save_position_survey_without_analysis_job;

revoke all on function private.save_position_survey_without_analysis_job(jsonb)
from public, anon, authenticated, service_role;

create or replace function private.save_position_survey(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  saved_result jsonb;
begin
  saved_result := private.save_position_survey_without_analysis_job(payload);

  insert into public.analysis_jobs (
    subject_type, subject_id, revision, status, requested_by
  ) values (
    'position_survey',
    (saved_result ->> 'id')::uuid,
    (saved_result ->> 'revision')::integer,
    'queued',
    current_user_id
  )
  on conflict (subject_type, subject_id, revision) do nothing;

  return saved_result;
end;
$$;

revoke all on function private.save_position_survey(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.save_position_survey(jsonb) to authenticated;

create or replace function public.save_position_survey(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_position_survey(payload);
$$;

revoke all on function public.save_position_survey(jsonb) from public, anon, service_role;
grant execute on function public.save_position_survey(jsonb) to authenticated;

-- Repair only current source rows that still need analysis and have no durable job.
with orphan_candidates as (
  select 'employee_assessment'::text as subject_type, assessment.id as subject_id,
    assessment.revision, assessment.user_id as requested_by, assessment.updated_at
  from public.employee_assessments assessment
  where assessment.analysis_status in ('pending', 'stale')
  union all
  select 'position_survey'::text, survey.id, survey.revision, survey.user_id, survey.updated_at
  from public.position_demand_surveys survey
  where survey.analysis_status in ('pending', 'stale')
)
insert into public.analysis_jobs (subject_type, subject_id, revision, status, requested_by)
select candidate.subject_type, candidate.subject_id, candidate.revision, 'queued', candidate.requested_by
from orphan_candidates candidate
where not exists (
  select 1 from public.analysis_jobs job
  where job.subject_type = candidate.subject_type
    and job.subject_id = candidate.subject_id
    and job.revision = candidate.revision
)
on conflict (subject_type, subject_id, revision) do nothing;

create or replace function public.backfill_orphan_analysis_jobs(p_limit integer)
returns table(subject_type text, subject_id uuid, revision integer)
language sql
security invoker
set search_path = ''
as $$
  with orphan_candidates as (
    select 'employee_assessment'::text as subject_type, assessment.id as subject_id,
      assessment.revision, assessment.user_id as requested_by, assessment.updated_at
    from public.employee_assessments assessment
    where assessment.analysis_status in ('pending', 'stale')
      and not exists (
        select 1 from public.analysis_jobs job
        where job.subject_type = 'employee_assessment'
          and job.subject_id = assessment.id
          and job.revision = assessment.revision
      )
    union all
    select 'position_survey'::text, survey.id, survey.revision, survey.user_id, survey.updated_at
    from public.position_demand_surveys survey
    where survey.analysis_status in ('pending', 'stale')
      and not exists (
        select 1 from public.analysis_jobs job
        where job.subject_type = 'position_survey'
          and job.subject_id = survey.id
          and job.revision = survey.revision
      )
  ), bounded_candidates as (
    select * from orphan_candidates
    order by updated_at, subject_type, subject_id
    limit least(greatest(coalesce(p_limit, 1), 1), 20)
  ), inserted as (
    insert into public.analysis_jobs (subject_type, subject_id, revision, status, requested_by)
    select candidate.subject_type, candidate.subject_id, candidate.revision, 'queued', candidate.requested_by
    from bounded_candidates candidate
    on conflict (subject_type, subject_id, revision) do nothing
    returning analysis_jobs.subject_type, analysis_jobs.subject_id, analysis_jobs.revision
  )
  select inserted.subject_type, inserted.subject_id, inserted.revision from inserted;
$$;

revoke all on function public.backfill_orphan_analysis_jobs(integer) from public, anon, authenticated, service_role;
grant execute on function public.backfill_orphan_analysis_jobs(integer) to service_role;

create table private.analysis_job_admissions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  job_id uuid not null references public.analysis_jobs(id) on delete restrict,
  window_date date not null,
  created_at timestamptz not null default now(),
  unique (job_id)
);

create index analysis_job_admissions_actor_window_idx
on private.analysis_job_admissions(actor_id, window_date, created_at);

create or replace function private.reject_analysis_job_admission_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'analysis job admission ledger is append-only' using errcode = '55000';
end;
$$;

create trigger prevent_analysis_job_admission_mutation
before update or delete on private.analysis_job_admissions
for each row execute function private.reject_analysis_job_admission_mutation();

revoke all on private.analysis_job_admissions from public, anon, authenticated, service_role;
revoke all on function private.reject_analysis_job_admission_mutation() from public, anon, authenticated, service_role;

create or replace function private.check_analysis_job_admission(
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
  daily_count integer;
  retry_after_seconds integer;
begin
  if p_actor_id is null or p_job_id is null or p_daily_limit is null or p_daily_limit not between 1 and 100 then
    raise exception 'invalid analysis admission payload' using errcode = '22023';
  end if;
  perform 1 from public.analysis_jobs job
  where job.id = p_job_id and job.requested_by = p_actor_id
  for key share;
  if not found then
    raise exception 'analysis job requester mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'analysis-job-admission:' || p_actor_id::text || ':' || current_date::text,
    0
  ));

  if exists (select 1 from private.analysis_job_admissions admission where admission.job_id = p_job_id) then
    return jsonb_build_object('kind', 'already_consumed');
  end if;

  select count(*) into daily_count
  from private.analysis_job_admissions admission
  where admission.actor_id = p_actor_id and admission.window_date = current_date;

  if daily_count >= p_daily_limit then
    retry_after_seconds := least(86400, greatest(1,
      ceil(extract(epoch from (date_trunc('day', now()) + interval '1 day' - now())))::integer
    ));
    return jsonb_build_object('kind', 'quota_exceeded', 'retryAfterSeconds', retry_after_seconds);
  end if;

  return jsonb_build_object('kind', 'ready');
end;
$$;

create or replace function private.consume_analysis_job_admission(
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
  admission_result jsonb;
begin
  admission_result := private.check_analysis_job_admission(p_actor_id, p_job_id, p_daily_limit);
  if admission_result ->> 'kind' <> 'ready' then
    return admission_result;
  end if;

  insert into private.analysis_job_admissions(actor_id, job_id, window_date)
  values (p_actor_id, p_job_id, current_date)
  on conflict (job_id) do nothing;

  return jsonb_build_object('kind', 'consumed');
end;
$$;

revoke all on function private.check_analysis_job_admission(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function private.consume_analysis_job_admission(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function private.check_analysis_job_admission(uuid, uuid, integer) to service_role;
grant execute on function private.consume_analysis_job_admission(uuid, uuid, integer) to service_role;

-- Replace the 1500 admin retry gates forward-only so NULL can never disable
-- cooldown or daily quota checks at the database authority boundary.
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
  if p_actor_id is null or p_job_id is null or p_daily_limit is null or p_daily_limit not between 1 and 100 then
    raise exception 'invalid admin retry quota' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.user_roles role
    where role.user_id = p_actor_id and role.role = 'admin' and role.status = 'active'
  ) then
    raise exception 'active admin required' using errcode = '42501';
  end if;

  perform 1 from public.analysis_jobs job where job.id = p_job_id for key share;
  if not found then raise exception 'analysis job not found' using errcode = 'P0002'; end if;

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
  if p_cooldown_seconds is null or p_cooldown_seconds not between 30 and 86400
    or p_daily_limit is null or p_daily_limit not between 1 and 100
  then
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

revoke all on function public.queue_analysis_retry_with_throttle(text, uuid, integer, uuid, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.queue_analysis_retry_with_throttle(text, uuid, integer, uuid, integer, integer) to service_role;

create or replace function public.check_analysis_job_quota(
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
  job public.analysis_jobs%rowtype;
begin
  if p_subject_type is null or p_subject_type not in ('employee_assessment', 'position_survey')
    or p_subject_id is null or p_revision is null or p_revision < 1
    or p_actor_id is null or p_daily_limit is null or p_daily_limit not between 1 and 100
  then
    raise exception 'invalid analysis quota preflight payload' using errcode = '22023';
  end if;

  select * into job
  from public.analysis_jobs
  where subject_type = p_subject_type and subject_id = p_subject_id and revision = p_revision;

  if not found then
    return jsonb_build_object('kind', 'missing');
  end if;

  if job.requested_by is distinct from p_actor_id and not exists (
    select 1 from public.user_roles role
    where role.user_id = p_actor_id and role.role = 'admin' and role.status = 'active'
  ) then
    raise exception 'analysis job requester mismatch' using errcode = '42501';
  end if;

  return private.check_analysis_job_admission(job.requested_by, job.id, p_daily_limit);
end;
$$;

revoke all on function public.check_analysis_job_quota(text, uuid, integer, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.check_analysis_job_quota(text, uuid, integer, uuid, integer) to service_role;

-- Keep the old enqueue name as a transition wrapper. Before 1600 it creates
-- the job; after 1600 save-time insertion is authoritative, so it only checks.
create or replace function public.enqueue_analysis_job_with_quota(
  p_subject_type text,
  p_subject_id uuid,
  p_revision integer,
  p_actor_id uuid,
  p_daily_limit integer
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.check_analysis_job_quota(
    p_subject_type, p_subject_id, p_revision, p_actor_id, p_daily_limit
  );
$$;

revoke all on function public.enqueue_analysis_job_with_quota(text, uuid, integer, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_analysis_job_with_quota(text, uuid, integer, uuid, integer) to service_role;

create or replace function public.claim_analysis_job(
  p_job_id uuid,
  p_model_key text,
  p_prompt_version text,
  p_daily_limit integer
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
  admission_result jsonb;
  next_database_day timestamptz;
begin
  if p_daily_limit is null or p_daily_limit not between 1 and 100 then
    raise exception 'invalid analysis admission limit' using errcode = '22023';
  end if;

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
      case
        when job.status = 'complete' then 'already_complete'
        when job.status = 'running' then 'already_running'
        when job.status = 'queued' then 'deferred'
        else 'terminal'
      end,
      'analysis', to_jsonb(saved_result)
    );
  end if;

  admission_result := private.consume_analysis_job_admission(job.requested_by, job.id, p_daily_limit);
  if admission_result ->> 'kind' = 'quota_exceeded' then
    next_database_day := date_trunc('day', now()) + interval '1 day';
    update public.analysis_jobs
    set status = 'queued', next_retry_at = next_database_day, locked_at = null,
        lease_token = null, lease_generation = lease_generation + 1
    where id = job.id
    returning * into job;
    insert into public.analysis_results (
      job_id, subject_type, subject_id, revision, status, result_payload, evidence_index,
      attempt_count, error_code, error_summary, model_key, prompt_version
    ) values (
      job.id, job.subject_type, job.subject_id, job.revision, 'queued', null, '[]'::jsonb,
      job.attempt_count, null, null, p_model_key, p_prompt_version
    )
    on conflict (subject_type, subject_id, revision) do update set
      job_id = excluded.job_id,
      status = 'queued',
      result_payload = null,
      evidence_index = '[]'::jsonb,
      attempt_count = job.attempt_count,
      error_code = null,
      error_summary = null,
      model_key = excluded.model_key,
      prompt_version = excluded.prompt_version
    returning * into saved_result;
    return jsonb_build_object(
      'kind', 'deferred',
      'retryAfterSeconds', admission_result -> 'retryAfterSeconds',
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

revoke all on function public.claim_analysis_job(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_analysis_job(uuid, text, text, integer) to service_role;

-- Emergency rollback compatibility for the pre-1600 worker. It uses the
-- strictest supported actor/day limit because the legacy signature carries no
-- runtime limit; the current four-argument worker remains the normal path.
create or replace function public.claim_analysis_job(
  p_job_id uuid,
  p_model_key text,
  p_prompt_version text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.claim_analysis_job(p_job_id, p_model_key, p_prompt_version, 1);
$$;

revoke all on function public.claim_analysis_job(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_analysis_job(uuid, text, text) to service_role;
