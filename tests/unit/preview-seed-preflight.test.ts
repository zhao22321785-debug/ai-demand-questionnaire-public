import preflightHandler, { config } from '../../netlify/functions/preview-seed-preflight';

const approvedSupabaseUrl = 'https://exampleprojectref123.supabase.co';
const internalSecret = 'test-only-internal-secret';

function request(secret = internalSecret): Request {
  return new Request('https://public-preview--ai-demand-questionnaire.netlify.app/api/internal/preview-seed-preflight', {
    headers: { 'x-analysis-secret': secret },
  });
}

function stubValidMockRuntime(): void {
  vi.stubEnv('ANALYSIS_INTERNAL_SECRET', internalSecret);
  vi.stubEnv('ANALYSIS_MODEL_MODE', 'mock');
  vi.stubEnv('SUPABASE_URL', approvedSupabaseUrl);
}

beforeEach(stubValidMockRuntime);
afterEach(() => vi.unstubAllEnvs());

it('uses the protected read-only internal route', () => {
  expect(config).toEqual({ path: '/api/internal/preview-seed-preflight', method: 'GET' });
});

it('rejects an unauthorized request before exposing runtime metadata', async () => {
  const response = await preflightHandler(request('wrong-secret'), { deploy: { context: 'branch-deploy' } });

  expect(response.status).toBe(403);
  expect(await response.text()).toBe('禁止访问');
});

it.each([
  { deployContext: 'production', modelMode: 'mock', label: 'production deploy' },
  { deployContext: 'branch-deploy', modelMode: 'openai', label: 'OpenAI runtime' },
])('fails closed for $label', async ({ deployContext, modelMode }) => {
  vi.stubEnv('ANALYSIS_MODEL_MODE', modelMode);
  if (modelMode === 'openai') {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-openai-key');
    vi.stubEnv('OPENAI_MODEL', 'test-model');
  }

  const response = await preflightHandler(request(), { deploy: { context: deployContext } });
  expect(response.status).toBe(500);
});

it('fails closed for the wrong Supabase project', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://another-project.supabase.co');

  const response = await preflightHandler(request(), { deploy: { context: 'deploy-preview' } });
  expect(response.status).toBe(500);
});

it.each(['branch-deploy', 'deploy-preview'])('returns only approved non-secret metadata for %s', async (deployContext) => {
  const response = await preflightHandler(request(), { deploy: { context: deployContext } });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    accepted: true,
    deployContext,
    supabaseProjectRef: 'exampleprojectref123',
    supabaseHost: 'exampleprojectref123.supabase.co',
    modelKey: 'deterministic-mock',
  });
});
