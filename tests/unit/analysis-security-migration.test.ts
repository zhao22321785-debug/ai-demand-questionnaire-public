import sql from '../../supabase/migrations/20260724150000_analysis_security_hardening.sql?raw';

it('fences every analysis job write with the current lease token and running status', () => {
  expect(sql).toMatch(/add column lease_token uuid/i);
  expect(sql).toMatch(/lease_generation = lease_generation \+ 1/i);
  expect(sql).toMatch(/create or replace function public\.record_analysis_job_attempt[\s\S]+?job\.status <> 'running'[\s\S]+?job\.lease_token is distinct from p_lease_token/i);
  expect(sql).toMatch(/create or replace function public\.finalize_analysis_job[\s\S]+?job\.status <> 'running'[\s\S]+?job\.lease_token is distinct from p_lease_token/i);
  expect(sql).toMatch(/requeue_stalled_analysis_jobs[\s\S]+?lease_token = null[\s\S]+?lease_generation = lease_generation \+ 1/i);
});

it('atomically finalizes an aggregate run only for its locked running snapshot', () => {
  expect(sql).toMatch(/create or replace function public\.finalize_aggregate_analysis_run/i);
  expect(sql).toMatch(/for share/i);
  expect(sql).toMatch(/status <> 'running'/i);
  expect(sql).toMatch(/source_snapshot is distinct from p_expected_snapshot/i);
  expect(sql).toMatch(/current_snapshot is distinct from p_expected_snapshot/i);
  expect(sql).toMatch(/final_status := 'stale'/i);
});

it('provides atomic user quota and administrator retry throttling RPCs', () => {
  expect(sql).toMatch(/enqueue_analysis_job_with_quota/i);
  expect(sql).toMatch(/pg_advisory_xact_lock/i);
  expect(sql).toMatch(/queue_analysis_retry_with_throttle/i);
  expect(sql).toMatch(/last_manual_retry_at/i);
});

it('keeps requested_by immutable while atomically metering one admin across different jobs', () => {
  const retryFunction = sql.match(/create or replace function public\.queue_analysis_retry_with_throttle[\s\S]+?\n\$\$;/i)?.[0] ?? '';
  expect(retryFunction).not.toBe('');
  expect(retryFunction).not.toMatch(/requested_by\s*=/i);
  expect(retryFunction).toMatch(/p_daily_limit integer/i);
  expect(retryFunction).toMatch(/private\.consume_analysis_admin_retry_quota\(p_actor_id, job\.id, p_daily_limit\)/i);
  expect(sql).toMatch(/create table private\.analysis_admin_retry_events/i);
  expect(sql).toMatch(/create or replace function private\.consume_analysis_admin_retry_quota[\s\S]+?pg_advisory_xact_lock[\s\S]+?p_actor_id[\s\S]+?current_date/i);
  expect(sql).toMatch(/analysis_admin_retry_events[\s\S]+?actor_id[\s\S]+?job_id[\s\S]+?window_date/i);
  expect(sql).toMatch(/revoke all on private\.analysis_admin_retry_events from public, anon, authenticated, service_role/i);
  expect(sql).toMatch(/grant execute on function private\.consume_analysis_admin_retry_quota\(uuid, uuid, integer\) to service_role/i);
});
