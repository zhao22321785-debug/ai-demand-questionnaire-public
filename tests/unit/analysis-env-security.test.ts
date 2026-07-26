import { readAnalysisRuntimeLimits, readCallbackOrigin, readModelConfig } from '../../netlify/functions/_shared/env';

const base = { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'configured-model' };

it('allows the official OpenAI host without an explicit gateway allowlist', () => {
  expect(readModelConfig(base, true).baseURL).toBe('https://api.openai.com/v1');
});

it.each([
  'http://gateway.example.com/v1',
  'https://user:pass@gateway.example.com/v1',
  'https://localhost/v1',
  'https://127.0.0.1/v1',
  'https://169.254.169.254/v1',
  'https://10.0.0.1/v1',
])('rejects an unsafe production OPENAI_BASE_URL: %s', (baseURL) => {
  expect(() => readModelConfig({ ...base, OPENAI_BASE_URL: baseURL, OPENAI_ALLOWED_HOSTS: 'gateway.example.com' }, true)).toThrow();
});

it('requires a compatible gateway hostname to be explicitly allowlisted', () => {
  expect(() => readModelConfig({ ...base, OPENAI_BASE_URL: 'https://gateway.example.com/v1' }, true)).toThrow(/OPENAI_ALLOWED_HOSTS/);
  expect(readModelConfig({ ...base, OPENAI_BASE_URL: 'https://gateway.example.com/v1', OPENAI_ALLOWED_HOSTS: 'gateway.example.com' }, true).baseURL)
    .toBe('https://gateway.example.com/v1');
});

it('uses safe bounded defaults and accepts bounded server overrides', () => {
  expect(readAnalysisRuntimeLimits({})).toEqual({
    modelTimeoutMs: 45_000,
    maxResponseBytes: 524_288,
    maxOutputTokens: 2_000,
    maxRetryDelayMs: 60_000,
    userDailyLimit: 5,
    adminRetryCooldownSeconds: 300,
    adminDailyRetryLimit: 10,
    reconcileBudgetMs: 50_000,
    reconcileJobLimit: 5,
  });
  expect(() => readAnalysisRuntimeLimits({ ANALYSIS_USER_DAILY_LIMIT: '0' })).toThrow();
  expect(() => readAnalysisRuntimeLimits({ ANALYSIS_ADMIN_DAILY_RETRY_LIMIT: '0' })).toThrow();
});

it('uses only the fixed callback origin and permits localhost only outside production', () => {
  expect(readCallbackOrigin('https://internal.example.com/path', true)).toBe('https://internal.example.com');
  expect(() => readCallbackOrigin('http://internal.example.com', true)).toThrow();
  expect(readCallbackOrigin('http://localhost:8888', false)).toBe('http://localhost:8888');
  expect(() => readCallbackOrigin('http://localhost:8888', true)).toThrow();
});
