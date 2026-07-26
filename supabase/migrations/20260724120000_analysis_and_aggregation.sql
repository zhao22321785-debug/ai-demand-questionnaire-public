create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('employee_assessment', 'position_survey')),
  subject_id uuid not null,
  revision integer not null check (revision > 0),
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'failed', 'stale')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  manual_retry_count integer not null default 0 check (manual_retry_count >= 0),
  requested_by uuid references auth.users(id) on delete set null,
  next_retry_at timestamptz,
  locked_at timestamptz,
  error_code text,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id, revision)
);

create table public.analysis_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.analysis_jobs(id) on delete cascade,
  subject_type text not null check (subject_type in ('employee_assessment', 'position_survey')),
  subject_id uuid not null,
  revision integer not null check (revision > 0),
  status text not null check (status in ('queued', 'running', 'complete', 'failed', 'stale')),
  result_payload jsonb,
  evidence_index jsonb not null default '[]'::jsonb,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  error_code text,
  error_summary text,
  model_key text,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id, revision),
  check (jsonb_typeof(evidence_index) = 'array'),
  check (
    (status = 'complete' and result_payload is not null and jsonb_typeof(result_payload) = 'object') or
    (status <> 'complete')
  )
);

create table public.aggregate_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.survey_batches(id),
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'failed', 'stale')),
  rule_version text not null,
  prompt_version text not null,
  model_key text,
  min_sample_size integer not null check (min_sample_size between 2 and 100),
  source_snapshot jsonb not null default '[]'::jsonb,
  result_payload jsonb,
  error_code text,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(source_snapshot) = 'array'),
  check (
    (status = 'complete' and result_payload is not null and jsonb_typeof(result_payload) = 'object') or
    (status <> 'complete')
  )
);

create index analysis_jobs_subject_idx on public.analysis_jobs(subject_type, subject_id, revision desc);
create index analysis_jobs_queue_idx on public.analysis_jobs(status, next_retry_at, created_at)
where status in ('queued', 'running');
create index analysis_results_subject_idx on public.analysis_results(subject_type, subject_id, revision desc);
create index aggregate_analysis_runs_batch_idx on public.aggregate_analysis_runs(batch_id, created_at desc);
create unique index aggregate_analysis_runs_one_current_idx
on public.aggregate_analysis_runs(batch_id)
where status in ('queued', 'running', 'complete');

create trigger set_analysis_jobs_updated_at
before update on public.analysis_jobs
for each row execute function private.set_updated_at();

create trigger set_analysis_results_updated_at
before update on public.analysis_results
for each row execute function private.set_updated_at();

create trigger set_aggregate_analysis_runs_updated_at
before update on public.aggregate_analysis_runs
for each row execute function private.set_updated_at();

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
    update public.analysis_jobs set status = 'stale', next_retry_at = null where id = job.id;
    insert into public.analysis_results (
      job_id, subject_type, subject_id, revision, status, result_payload, evidence_index,
      attempt_count, error_code, error_summary, model_key, prompt_version
    ) values (
      job.id, job.subject_type, job.subject_id, job.revision, 'stale', null, '[]'::jsonb,
      job.attempt_count, null, null, p_model_key, p_prompt_version
    )
    on conflict (subject_type, subject_id, revision) do update set status = 'stale'
    returning * into saved_result;
    return jsonb_build_object('kind', 'terminal', 'analysis', to_jsonb(saved_result));
  end if;

  if job.status <> 'queued' then
    select * into saved_result from public.analysis_results where job_id = job.id;
    return jsonb_build_object(
      'kind',
      case job.status when 'complete' then 'already_complete' when 'running' then 'already_running' else 'terminal' end,
      'analysis', to_jsonb(saved_result)
    );
  end if;

  update public.analysis_jobs
  set status = 'running', locked_at = now(), next_retry_at = null
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
    prompt_version = excluded.prompt_version;

  return jsonb_build_object('kind', 'claimed', 'jobId', job.id, 'attemptCount', job.attempt_count);
end;
$$;

revoke all on function public.claim_analysis_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_analysis_job(uuid, text, text) to service_role;

create or replace function public.finalize_analysis_job(
  p_job_id uuid,
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
  then
    raise exception 'invalid analysis finalization payload' using errcode = '22023';
  end if;

  select * into job
  from public.analysis_jobs
  where id = p_job_id;

  if not found then
    raise exception 'analysis job not found' using errcode = 'P0002';
  end if;

  if job.subject_type = 'employee_assessment' then
    select revision, batch_id into current_revision, current_batch_id
    from public.employee_assessments
    where id = job.subject_id
    for update;
  elsif job.subject_type = 'position_survey' then
    select revision, batch_id into current_revision, current_batch_id
    from public.position_demand_surveys
    where id = job.subject_id
    for update;
  else
    raise exception 'unsupported analysis subject type' using errcode = '22023';
  end if;

  select * into job
  from public.analysis_jobs
  where id = p_job_id
  for update;

  if current_revision is distinct from job.revision or job.status = 'stale' or p_terminal_status = 'stale' then
    final_status := 'stale';
  else
    if job.status <> 'running' then
      raise exception 'analysis job is not running' using errcode = '55000';
    end if;
    final_status := p_terminal_status;
  end if;

  update public.analysis_jobs
  set status = final_status,
      attempt_count = greatest(attempt_count, p_attempt_count),
      next_retry_at = null,
      error_code = case when final_status = 'failed' then p_error_code else null end,
      error_summary = case when final_status = 'failed' then p_error_summary else null end
  where id = job.id;

  update public.analysis_results
  set status = final_status,
      result_payload = case when final_status = 'complete' then p_result_payload else result_payload end,
      evidence_index = case when final_status = 'complete' then p_evidence_index else evidence_index end,
      attempt_count = greatest(attempt_count, p_attempt_count),
      error_code = case when final_status = 'failed' then p_error_code else null end,
      error_summary = case when final_status = 'failed' then p_error_summary else null end
  where job_id = job.id
  returning * into saved_result;

  if not found then
    raise exception 'analysis result not found' using errcode = 'P0002';
  end if;

  if current_revision = job.revision then
    if job.subject_type = 'employee_assessment' then
      update public.employee_assessments set analysis_status = final_status where id = job.subject_id and revision = job.revision;
    else
      update public.position_demand_surveys set analysis_status = final_status where id = job.subject_id and revision = job.revision;
    end if;
    update public.aggregate_analysis_runs
    set status = 'stale'
    where batch_id = current_batch_id
      and status = 'complete';
  end if;

  return to_jsonb(saved_result);
end;
$$;

revoke all on function public.finalize_analysis_job(uuid, text, jsonb, jsonb, integer, text, text) from public, anon, authenticated;
grant execute on function public.finalize_analysis_job(uuid, text, jsonb, jsonb, integer, text, text) to service_role;

create or replace function private.mark_subject_analysis_stale()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_subject_type text;
begin
  if new.revision = old.revision then
    return new;
  end if;

  current_subject_type := case tg_table_name
    when 'employee_assessments' then 'employee_assessment'
    when 'position_demand_surveys' then 'position_survey'
    else null
  end;

  if current_subject_type is null then
    raise exception 'unsupported analysis subject table';
  end if;

  update public.analysis_jobs
  set status = 'stale', next_retry_at = null
  where subject_type = current_subject_type
    and subject_id = new.id
    and revision < new.revision
    and status <> 'stale';

  update public.analysis_results
  set status = 'stale'
  where subject_type = current_subject_type
    and subject_id = new.id
    and revision < new.revision
    and status <> 'stale';

  update public.aggregate_analysis_runs
  set status = 'stale'
  where batch_id = new.batch_id
    and status <> 'stale';

  return new;
end;
$$;

revoke all on function private.mark_subject_analysis_stale() from public, anon, authenticated;

create trigger mark_employee_analysis_stale
after update of revision on public.employee_assessments
for each row execute function private.mark_subject_analysis_stale();

create trigger mark_position_analysis_stale
after update of revision on public.position_demand_surveys
for each row execute function private.mark_subject_analysis_stale();

alter table public.analysis_jobs enable row level security;
alter table public.analysis_results enable row level security;
alter table public.aggregate_analysis_runs enable row level security;

create policy analysis_jobs_read_self_or_admin
on public.analysis_jobs for select
to authenticated
using (
  (select private.is_active_user()) and
  (
    (select private.is_admin()) or
    (
      subject_type = 'employee_assessment' and exists (
        select 1 from public.employee_assessments assessment
        where assessment.id = analysis_jobs.subject_id
          and assessment.user_id = (select auth.uid())
      )
    ) or
    (
      subject_type = 'position_survey' and exists (
        select 1 from public.position_demand_surveys survey
        where survey.id = analysis_jobs.subject_id
          and survey.user_id = (select auth.uid())
      )
    )
  )
);

create policy analysis_results_read_self_or_admin
on public.analysis_results for select
to authenticated
using (
  (select private.is_active_user()) and
  (
    (select private.is_admin()) or
    (
      subject_type = 'employee_assessment' and exists (
        select 1 from public.employee_assessments assessment
        where assessment.id = analysis_results.subject_id
          and assessment.user_id = (select auth.uid())
      )
    ) or
    (
      subject_type = 'position_survey' and exists (
        select 1 from public.position_demand_surveys survey
        where survey.id = analysis_results.subject_id
          and survey.user_id = (select auth.uid())
      )
    )
  )
);

create policy aggregate_analysis_runs_read_admin
on public.aggregate_analysis_runs for select
to authenticated
using ((select private.is_active_user()) and (select private.is_admin()));

revoke all on public.analysis_jobs, public.analysis_results, public.aggregate_analysis_runs from anon, authenticated;
grant select on public.analysis_jobs, public.analysis_results to authenticated;
grant select on public.aggregate_analysis_runs to authenticated;
