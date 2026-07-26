import { queueAnalysisRetry } from '../../netlify/functions/_shared/supabase-analysis-store';

const request = { subjectType: 'employee_assessment' as const, subjectId: '22222222-2222-4222-8222-222222222222', revision: 1 };

it('passes the admin daily limit to the atomic retry RPC and returns quota Retry-After', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { kind: 'quota_exceeded', retryAfterSeconds: 3_600 }, error: null });
  let response: Response | undefined;
  try {
    await queueAnalysisRetry({ rpc } as never, request, '11111111-1111-4111-8111-111111111111', 300, 10);
  } catch (error) {
    response = error as Response;
  }
  expect(rpc).toHaveBeenCalledWith('queue_analysis_retry_with_throttle', expect.objectContaining({
    p_actor_id: '11111111-1111-4111-8111-111111111111',
    p_cooldown_seconds: 300,
    p_daily_limit: 10,
  }));
  expect(response?.status).toBe(429);
  expect(response?.headers.get('retry-after')).toBe('3600');
});

it('returns per-job cooldown Retry-After without dispatching a retry', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { kind: 'throttled', retryAfterSeconds: 120 }, error: null });
  await expect(queueAnalysisRetry({ rpc } as never, request, '11111111-1111-4111-8111-111111111111', 300, 10))
    .rejects.toMatchObject({ status: 429, headers: expect.any(Headers) });
  try {
    await queueAnalysisRetry({ rpc } as never, request, '11111111-1111-4111-8111-111111111111', 300, 10);
  } catch (error) {
    expect((error as Response).headers.get('retry-after')).toBe('120');
  }
});
