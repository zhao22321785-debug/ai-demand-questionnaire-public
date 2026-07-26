const mocks = vi.hoisted(() => ({
  authenticate: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', role: 'employee', status: 'active' }),
  authorize: vi.fn().mockResolvedValue(undefined),
  preflight: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../netlify/functions/_shared/auth', () => ({
  authenticateRequest: mocks.authenticate,
  authorizeSubject: mocks.authorize,
}));
vi.mock('../../netlify/functions/_shared/supabase-admin', () => ({ createSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock('../../netlify/functions/_shared/supabase-analysis-store', () => ({
  preflightAnalysisJob: mocks.preflight,
  SupabaseAnalysisStore: class {},
}));

import analyzeHandler from '../../netlify/functions/analyze-submission';
import backgroundHandler from '../../netlify/functions/analyze-submission-background';

const payload = { subjectType: 'employee_assessment', subjectId: '22222222-2222-4222-8222-222222222222', revision: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ANALYSIS_INTERNAL_SECRET', 'test-internal-secret');
  vi.stubEnv('ANALYSIS_CALLBACK_ORIGIN', 'https://trusted.example.com/base/path');
});

afterEach(() => vi.unstubAllEnvs());

it('ignores a malicious inbound URL when dispatching the secret-bearing callback', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  const response = await analyzeHandler(new Request('https://attacker.example/api/analyze', {
    method: 'POST', headers: { authorization: 'Bearer test' }, body: JSON.stringify(payload),
  }), { deploy: { context: 'production' } });
  expect(response.status).toBe(202);
  expect(fetcher).toHaveBeenCalledWith('https://trusted.example.com/api/internal/analyze-background', expect.objectContaining({
    headers: expect.objectContaining({ 'x-analysis-secret': 'test-internal-secret' }),
  }));
  expect(mocks.preflight).toHaveBeenCalledWith(expect.anything(), payload, expect.any(String), 5);
});

it('authenticates the internal endpoint before attempting to parse its body', async () => {
  const response = await backgroundHandler(new Request('https://trusted.example.com/api/internal/analyze-background', {
    method: 'POST', headers: { 'x-analysis-secret': 'wrong' }, body: '{'.repeat(10_000),
  }));
  expect(response.status).toBe(403);
});
