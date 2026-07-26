import sql from '../../supabase/migrations/20260724160000_final_integration_hardening.sql?raw';

it('creates the current revision durable analysis job inside both save transactions', () => {
  expect(sql).toMatch(/create or replace function private\.save_employee_assessment\(payload jsonb\)[\s\S]+?insert into public\.analysis_jobs[\s\S]+?requested_by[\s\S]+?current_user_id/i);
  expect(sql).toMatch(/create or replace function private\.save_position_survey\(payload jsonb\)[\s\S]+?insert into public\.analysis_jobs[\s\S]+?requested_by[\s\S]+?current_user_id/i);
  expect(sql).toMatch(/create or replace function public\.save_employee_assessment\(payload jsonb\)[\s\S]+?security invoker[\s\S]+?select private\.save_employee_assessment\(payload\)/i);
  expect(sql).toMatch(/create or replace function public\.save_position_survey\(payload jsonb\)[\s\S]+?security invoker[\s\S]+?select private\.save_position_survey\(payload\)/i);
  expect(sql).toMatch(/revoke all on function public\.save_employee_assessment\(jsonb\) from public, anon, service_role[\s\S]+?grant execute on function public\.save_employee_assessment\(jsonb\) to authenticated/i);
  expect(sql).toMatch(/revoke all on function public\.save_position_survey\(jsonb\) from public, anon, service_role[\s\S]+?grant execute on function public\.save_position_survey\(jsonb\) to authenticated/i);
  expect(sql).toMatch(/on conflict \(subject_type, subject_id, revision\) do nothing/i);
});

it('backfills missing current pending or stale jobs and exposes only a bounded service-role orphan repair RPC', () => {
  expect(sql).toMatch(/analysis_status in \('pending', 'stale'\)[\s\S]+?insert into public\.analysis_jobs/i);
  expect(sql).toMatch(/create or replace function public\.backfill_orphan_analysis_jobs\(p_limit integer\)[\s\S]+?limit least\(greatest\(coalesce\(p_limit, 1\), 1\), 20\)/i);
  expect(sql).toMatch(/revoke all on function public\.backfill_orphan_analysis_jobs\(integer\) from public, anon, authenticated, service_role/i);
  expect(sql).toMatch(/grant execute on function public\.backfill_orphan_analysis_jobs\(integer\) to service_role/i);
});

it('admits durable jobs at claim with an append-only actor-job ledger and defers excess work to the next database day', () => {
  expect(sql).toMatch(/create table private\.analysis_job_admissions[\s\S]+?unique \(job_id\)/i);
  expect(sql).toMatch(/create trigger prevent_analysis_job_admission_mutation[\s\S]+?before update or delete/i);
  expect(sql).toMatch(/analysis-job-admission:[\s\S]+?actor_id::text[\s\S]+?current_date::text/i);
  expect(sql).toMatch(/create or replace function public\.claim_analysis_job\([\s\S]+?p_daily_limit integer[\s\S]+?private\.consume_analysis_job_admission/i);
  expect(sql).toMatch(/quota_exceeded[\s\S]+?next_database_day := date_trunc\('day', now\(\)\) \+ interval '1 day'[\s\S]+?next_retry_at = next_database_day/i);
  expect(sql).toMatch(/on conflict \(job_id\) do nothing/i);
  expect(sql).toMatch(/create or replace function public\.check_analysis_job_quota[\s\S]+?job\.requested_by is distinct from p_actor_id[\s\S]+?public\.user_roles[\s\S]+?private\.check_analysis_job_admission\(job\.requested_by, job\.id, p_daily_limit\)/i);
  expect(sql).toMatch(/p_daily_limit is null or p_daily_limit not between 1 and 100/i);
  expect(sql).toMatch(/public\.queue_analysis_retry_with_throttle[\s\S]+?p_cooldown_seconds is null[\s\S]+?p_daily_limit is null/i);
  expect(sql).toMatch(/private\.check_analysis_job_admission[\s\S]+?for key share[\s\S]+?pg_advisory_xact_lock/i);
  expect(sql).toMatch(/private\.consume_analysis_admin_retry_quota[\s\S]+?analysis_jobs[\s\S]+?for key share[\s\S]+?analysis-admin-retry:/i);
});

it('keeps old RPC signatures as least-privilege rollout compatibility wrappers', () => {
  expect(sql).not.toMatch(/drop function public\.enqueue_analysis_job_with_quota/i);
  expect(sql).not.toMatch(/drop function public\.claim_analysis_job\(uuid, text, text\)/i);
  expect(sql).toMatch(/create or replace function public\.enqueue_analysis_job_with_quota[\s\S]+?select public\.check_analysis_job_quota/i);
  expect(sql).toMatch(/create or replace function public\.claim_analysis_job\([\s\S]+?p_prompt_version text[\s\S]+?select public\.claim_analysis_job\(p_job_id, p_model_key, p_prompt_version, 1\)/i);
  expect(sql).toMatch(/grant execute on function public\.enqueue_analysis_job_with_quota\(text, uuid, integer, uuid, integer\) to service_role/i);
  expect(sql).toMatch(/grant execute on function public\.claim_analysis_job\(uuid, text, text\) to service_role/i);
});

it('fails before enforcing one active batch and exposes an atomic service-only activation RPC', () => {
  const duplicateGuard = sql.search(/more than one active survey batch/i);
  const uniqueIndex = sql.search(/create unique index survey_batches_single_active_idx/i);
  expect(duplicateGuard).toBeGreaterThanOrEqual(0);
  expect(uniqueIndex).toBeGreaterThan(duplicateGuard);
  expect(sql).toMatch(/where status = 'active'/i);
  expect(sql).toMatch(/create or replace function private\.activate_survey_batch\(p_batch_id uuid\)[\s\S]+?pg_advisory_xact_lock[\s\S]+?target_batch\.status <> 'draft'[\s\S]+?survey_versions[\s\S]+?update public\.survey_batches[\s\S]+?set status = 'closed'[\s\S]+?set status = 'active'/i);
  expect(sql).toMatch(/revoke all on function public\.activate_survey_batch\(uuid\) from public, anon, authenticated, service_role/i);
  expect(sql).toMatch(/grant execute on function public\.activate_survey_batch\(uuid\) to service_role/i);
});
