import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingRpcError, preflightAnalysisJob, SupabaseAnalysisStore } from '../../netlify/functions/_shared/supabase-analysis-store';

const request = { subjectType: 'employee_assessment' as const, subjectId: '22222222-2222-4222-8222-222222222222', revision: 1 };

it('recognizes only PostgREST/Postgres missing-function errors as rollout-compatible', () => {
  expect(isMissingRpcError({ code: 'PGRST202' })).toBe(true);
  expect(isMissingRpcError({ code: '42883' })).toBe(true);
  expect(isMissingRpcError({ code: '42501' })).toBe(false);
});

it('falls back to the legacy enqueue RPC before the 1600 migration is installed', async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ data: { kind: 'queued', jobId: 'job-1' }, error: null });
  await preflightAnalysisJob({ rpc } as unknown as SupabaseClient, request, '11111111-1111-4111-8111-111111111111', 5);
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(['check_analysis_job_quota', 'enqueue_analysis_job_with_quota']);
});

it('falls back to the legacy three-argument claim RPC before the 1600 migration is installed', async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ data: { kind: 'claimed', jobId: 'job-1', leaseToken: 'lease-1', leaseGeneration: 1, attemptCount: 0 }, error: null });
  const chain = {
    select: vi.fn(), eq: vi.fn(), single: vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null }),
  };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  const client = { rpc, from: vi.fn(() => chain) } as unknown as SupabaseClient;
  await expect(new SupabaseAnalysisStore(client, 'model-1', 5).claim(request)).resolves.toEqual({
    kind: 'claimed', jobId: 'job-1', leaseToken: 'lease-1', leaseGeneration: 1, attemptCount: 0,
  });
  expect(rpc.mock.calls[0][1]).toHaveProperty('p_daily_limit', 5);
  expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_daily_limit');
});
