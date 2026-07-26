import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
const sources = await Promise.all(files.map(async (name) => ({ name, text: await readFile(new URL(name, migrationDirectory), 'utf8') })));
const sql = sources.map(({ text }) => text).join('\n');
const failures = [];
const finalHardening = sources.find(({ name }) => name === '20260724160000_final_integration_hardening.sql')?.text ?? '';

const matches = (pattern) => [...sql.matchAll(pattern)].map((match) => match[1]);
const tables = new Set(matches(/^create table public\.([a-z_]+)/gim));
const rlsTables = new Set(matches(/^alter table public\.([a-z_]+) enable row level security;/gim));
for (const table of tables) if (!rlsTables.has(table)) failures.push(`RLS missing for public.${table}`);

if (/create or replace function public\.[\s\S]{0,240}security definer/i.test(sql)) failures.push('SECURITY DEFINER function found in public schema');
if (!/revoke all on all tables in schema public from anon, authenticated;/i.test(sql)) failures.push('Explicit table privilege reset is missing');
if (/^grant\s+.+\s+to\s+anon\s*;/gim.test(sql)) failures.push('Business privilege granted to anon');
if (!/grant execute on function public\.save_employee_assessment\(jsonb\) to authenticated;/i.test(sql)) failures.push('Employee save RPC grant missing');
if (!/grant execute on function public\.save_position_survey\(jsonb\) to authenticated;/i.test(sql)) failures.push('Position save RPC grant missing');
if (!/create policy user_profiles_update_self[\s\S]+?using[\s\S]+?with check/i.test(sql)) failures.push('Profile UPDATE policy lacks USING/WITH CHECK');
if (/service_role[_-]?key|user_metadata|auth\.role\(\)/i.test(sql)) failures.push('Forbidden authorization pattern found');
if (!/set search_path = ''/i.test(sql)) failures.push('Hardened function search_path not found');
if (!/create or replace function private\.is_active_user\(\)/i.test(sql)) failures.push('Active-user authorization helper is missing');
if ((sql.match(/if not private\.is_active_user\(\)/gi) ?? []).length !== 2) failures.push('Both save RPCs must reject disabled users');
if ((sql.match(/batch\.starts_at is null or now\(\) >= batch\.starts_at/gi) ?? []).length !== 2) failures.push('Both save RPCs must enforce batch start time');
if ((sql.match(/batch\.ends_at is null or now\(\) < batch\.ends_at/gi) ?? []).length !== 2) failures.push('Both save RPCs must enforce batch end time');
if (!/ai_tool_ids uuid\[\]/i.test(sql)) failures.push('AI tool identifiers must use UUID arrays');
if (!/private\.is_valid_dimension_answers\(dimension_answers\)/i.test(sql)) failures.push('Dimension answer constraint is missing');
if (!/employee_status = 'never' and task_record\.item ->> 'aiUseStatus' <> 'never'/i.test(sql)) failures.push('Employee parent/task AI status consistency check is missing');

const bootstrap = sources.find(({ name }) => name.includes('bootstrap_m1_development_config'))?.text ?? '';
if (!/'M1 开发调研批次'[\s\S]+?'draft'/i.test(bootstrap)) failures.push('Development batch must remain draft until explicitly activated');

for (const table of ['analysis_jobs', 'analysis_results', 'aggregate_analysis_runs']) {
  if (!tables.has(table)) failures.push(`Analysis table public.${table} is missing`);
  if (/grant\s+(insert|update|delete|all)[^;]*public\.(analysis_jobs|analysis_results|aggregate_analysis_runs)[^;]*to\s+authenticated/gi.test(sql)) {
    failures.push('Client write privilege found on analysis tables');
    break;
  }
}
if (!/create policy analysis_results_read_self_or_admin[\s\S]+?analysis_results\.subject_id[\s\S]+?auth\.uid\(\)/i.test(sql)) failures.push('Analysis results ownership/admin RLS policy is missing');
if (!/create policy aggregate_analysis_runs_read_admin[\s\S]+?private\.is_admin\(\)/i.test(sql)) failures.push('Aggregate analysis admin-only RLS policy is missing');
if (!/create trigger mark_employee_analysis_stale[\s\S]+?private\.mark_subject_analysis_stale\(\)/i.test(sql)) failures.push('Employee analysis stale trigger is missing');
if (!/create trigger mark_position_analysis_stale[\s\S]+?private\.mark_subject_analysis_stale\(\)/i.test(sql)) failures.push('Position analysis stale trigger is missing');
if ((sql.match(/with \(security_invoker = true\)/gi) ?? []).length < 2) failures.push('Dashboard views must use security_invoker');
if (!/attempt_count integer not null default 0 check \(attempt_count between 0 and 3\)/i.test(sql)) failures.push('Analysis attempt bound is missing');
if (!/create or replace function public\.finalize_analysis_job[\s\S]+?for update[\s\S]+?current_revision is distinct from job\.revision/i.test(sql)) failures.push('Atomic revision-aware analysis finalizer is missing');
if (!/revoke all on function public\.finalize_analysis_job[\s\S]+?from public, anon, authenticated/i.test(sql)) failures.push('Analysis finalizer execute privileges are not restricted');
if (!/create or replace function public\.claim_analysis_job[\s\S]+?for update[\s\S]+?job\.status <> 'queued'/i.test(sql)) failures.push('Atomic revision-aware analysis claim is missing');
if (!/revoke all on function public\.claim_analysis_job[\s\S]+?from public, anon, authenticated/i.test(sql)) failures.push('Analysis claim execute privileges are not restricted');

const revisionTables = [
  'employee_assessment_revisions',
  'employee_task_demand_revisions',
  'position_survey_revisions',
  'position_work_item_revisions',
  'position_task_demand_revisions',
];
if (tables.size !== 20) failures.push(`Expected 20 public tables after revision history, found ${tables.size}`);
for (const table of revisionTables) {
  if (!tables.has(table)) failures.push(`Revision table public.${table} is missing`);
  if (!new RegExp(`create trigger prevent_${table}_mutation[\\s\\S]+?private\\.reject_revision_history_mutation\\(\\)`, 'i').test(sql)) {
    failures.push(`Append-only mutation guard missing for public.${table}`);
  }
  if (new RegExp(`grant\\s+(insert|update|delete|all)[^;]*public\\.${table}[^;]*to\\s+(authenticated|service_role)`, 'i').test(sql)) {
    failures.push(`Write privilege found on revision table public.${table}`);
  }
}
if (!/primary key \(assessment_id, revision\)/i.test(sql)) failures.push('Employee subject/revision uniqueness is missing');
if (!/primary key \(survey_id, revision\)/i.test(sql)) failures.push('Position subject/revision uniqueness is missing');
if (!/grant select on public\.employee_assessment_revisions, public\.employee_task_demand_revisions, public\.position_survey_revisions, public\.position_work_item_revisions, public\.position_task_demand_revisions to authenticated;/i.test(sql)) failures.push('Authenticated revision-history read grant is missing');
if (!/create policy employee_assessment_revisions_read_self_or_admin[\s\S]+?private\.is_admin\(\)[\s\S]+?auth\.uid\(\)/i.test(sql)) failures.push('Employee revision ownership/admin policy is missing');
if (!/create policy position_survey_revisions_read_self_or_admin[\s\S]+?private\.is_admin\(\)[\s\S]+?auth\.uid\(\)/i.test(sql)) failures.push('Position revision ownership/admin policy is missing');
if (!/create or replace function private\.archive_employee_assessment_revision[\s\S]+?employee_assessment_revisions[\s\S]+?employee_task_demand_revisions/i.test(sql)) failures.push('Employee parent/child revision archiver is missing');
if (!/create or replace function private\.archive_position_survey_revision[\s\S]+?position_survey_revisions[\s\S]+?position_work_item_revisions[\s\S]+?position_task_demand_revisions/i.test(sql)) failures.push('Position parent/child revision archiver is missing');
if (!/archive_employee_assessment_revision[\s\S]+?employee_assessments[\s\S]+?for update/i.test(sql)) failures.push('Employee revision archiver must lock the current subject');
if (!/archive_position_survey_revision[\s\S]+?position_demand_surveys[\s\S]+?for update/i.test(sql)) failures.push('Position revision archiver must lock the current subject');
if (!/employee revision history children are incomplete/i.test(sql)) failures.push('Employee incomplete child history guard is missing');
if (!/position revision history children are incomplete/i.test(sql)) failures.push('Position incomplete child history guard is missing');
if (!/create or replace function private\.save_employee_assessment\(payload jsonb\)[\s\S]+?archive_employee_assessment_revision\(existing_assessment_id\)[\s\S]+?save_employee_assessment_without_revision_history\(payload\)[\s\S]+?archive_employee_assessment_revision\(saved_assessment_id\)/i.test(sql)) failures.push('Employee save must archive before replacement and snapshot the saved revision');
if (!/create or replace function private\.save_position_survey\(payload jsonb\)[\s\S]+?archive_position_survey_revision\(existing_survey_id\)[\s\S]+?save_position_survey_without_revision_history\(payload\)[\s\S]+?archive_position_survey_revision\(saved_survey_id\)/i.test(sql)) failures.push('Position save must archive before replacement and snapshot the saved revision');

if (/grant\s+all\s+on\s+all\s+tables/i.test(sql)) failures.push('Broad service-role table grant found');
if (!/revoke all on schema public from service_role;/i.test(sql)) failures.push('service_role public schema reset is missing');
if (!/grant usage on schema public to service_role;/i.test(sql)) failures.push('service_role public schema usage grant is missing');
const serviceRoleAcl = [
  ['select', 'departments'],
  ['select', 'positions'],
  ['select', 'ai_tool_options'],
  ['select', 'survey_batches'],
  ['select', 'user_roles'],
  ['select', 'user_profiles'],
  ['select', 'employee_assessments'],
  ['select', 'position_demand_surveys'],
  ['select, insert, update', 'analysis_jobs'],
  ['select, insert, update', 'analysis_results'],
  ['select, insert, update', 'aggregate_analysis_runs'],
];
for (const [privileges, table] of serviceRoleAcl) {
  const normalized = privileges.replaceAll(', ', '\\s*,\\s*');
  if (!new RegExp(`grant\\s+${normalized}\\s+on\\s+public\\.${table}\\s+to\\s+service_role\\s*;`, 'i').test(sql)) {
    failures.push(`service_role ${privileges} grant missing for public.${table}`);
  }
}
if (!/grant update \(analysis_status\) on public\.employee_assessments to service_role;/i.test(sql)) failures.push('service_role analysis_status update grant missing for public.employee_assessments');
if (!/grant update \(analysis_status\) on public\.position_demand_surveys to service_role;/i.test(sql)) failures.push('service_role analysis_status update grant missing for public.position_demand_surveys');
if (!/grant select on public\.admin_response_statistics, public\.admin_dimension_statistics to service_role;/i.test(sql)) failures.push('service_role dashboard view grant is missing');
for (const table of ['survey_versions', 'employee_task_demands', 'position_work_items', 'position_task_demands', ...revisionTables]) {
  if (new RegExp(`grant\\s+[^;]+on\\s+public\\.${table}\\s+to\\s+service_role`, 'i').test(sql)) failures.push(`Unexpected service_role grant found on public.${table}`);
}
if (!/revoke all on function public\.save_employee_assessment\(jsonb\), public\.save_position_survey\(jsonb\) from service_role;/i.test(sql)) failures.push('service_role save-RPC revoke is missing');

if (!/add column lease_token uuid/i.test(sql) || !/add column lease_generation bigint/i.test(sql)) failures.push('Analysis lease fencing columns are missing');
if (!/create or replace function public\.record_analysis_job_attempt[\s\S]+?job\.status <> 'running'[\s\S]+?job\.lease_token is distinct from p_lease_token/i.test(sql)) failures.push('Attempt writes are not fenced by the current lease');
if (!/create or replace function public\.finalize_analysis_job[\s\S]+?job\.status <> 'running'[\s\S]+?job\.lease_token is distinct from p_lease_token/i.test(sql)) failures.push('Terminal writes are not fenced by the current lease');
if (!/requeue_stalled_analysis_jobs[\s\S]+?lease_token = null[\s\S]+?lease_generation = lease_generation \+ 1/i.test(sql)) failures.push('Stalled recovery does not invalidate the old lease');
if (!/create or replace function public\.finalize_aggregate_analysis_run[\s\S]+?for share[\s\S]+?for update[\s\S]+?source_snapshot is distinct from p_expected_snapshot[\s\S]+?current_snapshot is distinct from p_expected_snapshot/i.test(sql)) failures.push('Aggregate finalizer lacks locked source snapshot CAS');
if (/drop function public\.enqueue_analysis_job_with_quota\(text, uuid, integer, uuid, integer\)/i.test(finalHardening)) failures.push('Legacy enqueue RPC must remain as a rollout compatibility wrapper');
if (!/create table private\.analysis_job_admissions[\s\S]+?unique \(job_id\)/i.test(finalHardening)) failures.push('Per-job analysis admission ledger is missing');
if (!/create trigger prevent_analysis_job_admission_mutation[\s\S]+?before update or delete/i.test(finalHardening)) failures.push('Analysis admission ledger is not append-only');
if (!/create or replace function private\.consume_analysis_job_admission[\s\S]+?pg_advisory_xact_lock|create or replace function private\.check_analysis_job_admission[\s\S]+?pg_advisory_xact_lock/i.test(finalHardening)) failures.push('Actor-day analysis admission lock is missing');
if (!/create or replace function public\.claim_analysis_job\([\s\S]+?p_daily_limit integer[\s\S]+?private\.consume_analysis_job_admission/i.test(finalHardening)) failures.push('Claim-time analysis quota admission is missing');
if (!/next_database_day := date_trunc\('day', now\(\)\) \+ interval '1 day'[\s\S]+?next_retry_at = next_database_day/i.test(finalHardening)) failures.push('Quota-exceeded jobs are not deferred to the next database day');
if (!/grant execute on function public\.claim_analysis_job\(uuid, text, text, integer\) to service_role/i.test(finalHardening)) failures.push('Quota-aware claim RPC service-role grant is missing');
if (!/create or replace function public\.enqueue_analysis_job_with_quota[\s\S]+?select public\.check_analysis_job_quota/i.test(finalHardening)) failures.push('Legacy enqueue compatibility wrapper is missing');
if (!/create or replace function public\.claim_analysis_job\([\s\S]+?p_prompt_version text[\s\S]+?select public\.claim_analysis_job\(p_job_id, p_model_key, p_prompt_version, 1\)/i.test(finalHardening)) failures.push('Legacy claim compatibility wrapper is missing');
if (!/private\.check_analysis_job_admission[\s\S]+?p_daily_limit is null[\s\S]+?for key share[\s\S]+?pg_advisory_xact_lock/i.test(finalHardening)) failures.push('Analysis admission must reject NULL and lock job before actor advisory lock');
if (!/public\.queue_analysis_retry_with_throttle[\s\S]+?p_cooldown_seconds is null[\s\S]+?p_daily_limit is null/i.test(finalHardening)) failures.push('Admin retry throttle must reject NULL limits');
if (!/private\.consume_analysis_admin_retry_quota[\s\S]+?analysis_jobs[\s\S]+?for key share[\s\S]+?analysis-admin-retry:/i.test(finalHardening)) failures.push('Admin retry quota must lock job before actor advisory lock');
if (!/queue_analysis_retry_with_throttle[\s\S]+?last_manual_retry_at/i.test(sql)) failures.push('Manual retry throttling is missing');
const adminRetryFunction = sql.match(/create or replace function public\.queue_analysis_retry_with_throttle[\s\S]+?\n\$\$;/i)?.[0] ?? '';
if (/requested_by\s*=/i.test(adminRetryFunction)) failures.push('Manual retry must not change the original requested_by quota owner');
if (!/create table private\.analysis_admin_retry_events/i.test(sql)) failures.push('Private admin retry quota event ledger is missing');
if (!/create or replace function private\.consume_analysis_admin_retry_quota[\s\S]+?pg_advisory_xact_lock[\s\S]+?actor_id[\s\S]+?window_date/i.test(sql)) failures.push('Atomic cross-job admin daily retry quota is missing');
if (!/revoke all on private\.analysis_admin_retry_events from public, anon, authenticated, service_role/i.test(sql)) failures.push('Admin retry ledger direct access is not fully revoked');
if (!/grant execute on function private\.consume_analysis_admin_retry_quota\(uuid, uuid, integer\) to service_role/i.test(sql)) failures.push('Admin retry quota helper service_role grant is missing');

if (!/more than one active survey batch/i.test(finalHardening)) failures.push('Duplicate active batch migration guard is missing');
if (!/create unique index survey_batches_single_active_idx[\s\S]+?where status = 'active'/i.test(finalHardening)) failures.push('Active batch singleton index is missing');
if (!/create or replace function private\.activate_survey_batch[\s\S]+?pg_advisory_xact_lock[\s\S]+?target_batch\.status <> 'draft'[\s\S]+?set status = 'closed'[\s\S]+?set status = 'active'/i.test(finalHardening)) failures.push('Atomic validated batch activation helper is missing');
if (!/revoke all on function public\.activate_survey_batch\(uuid\) from public, anon, authenticated, service_role[\s\S]+?grant execute on function public\.activate_survey_batch\(uuid\) to service_role/i.test(finalHardening)) failures.push('Batch activation RPC privileges are not service-only');
if (!/create or replace function private\.save_employee_assessment\(payload jsonb\)[\s\S]+?insert into public\.analysis_jobs[\s\S]+?current_user_id/i.test(finalHardening)) failures.push('Employee save does not create its durable analysis job');
if (!/create or replace function private\.save_position_survey\(payload jsonb\)[\s\S]+?insert into public\.analysis_jobs[\s\S]+?current_user_id/i.test(finalHardening)) failures.push('Position save does not create its durable analysis job');
if (!/create or replace function public\.save_employee_assessment\(payload jsonb\)[\s\S]+?security invoker[\s\S]+?select private\.save_employee_assessment\(payload\)/i.test(finalHardening)) failures.push('Public employee save RPC is not explicitly rebound to the durable-job wrapper');
if (!/create or replace function public\.save_position_survey\(payload jsonb\)[\s\S]+?security invoker[\s\S]+?select private\.save_position_survey\(payload\)/i.test(finalHardening)) failures.push('Public position save RPC is not explicitly rebound to the durable-job wrapper');
if (!/create or replace function public\.backfill_orphan_analysis_jobs\(p_limit integer\)[\s\S]+?analysis_status in \('pending', 'stale'\)[\s\S]+?limit least\(greatest\(coalesce\(p_limit, 1\), 1\), 20\)/i.test(finalHardening)) failures.push('Bounded orphan analysis job repair RPC is missing');
if (!/revoke all on function public\.backfill_orphan_analysis_jobs\(integer\) from public, anon, authenticated, service_role[\s\S]+?grant execute on function public\.backfill_orphan_analysis_jobs\(integer\) to service_role/i.test(finalHardening)) failures.push('Orphan repair RPC privileges are not service-only');

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Reviewed ${files.length} migrations: ${tables.size} public tables, all with RLS; no anon grants or public SECURITY DEFINER functions.`);
