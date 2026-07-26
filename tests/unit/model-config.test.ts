import { readAggregateSampleSize, readModelConfig } from '../../netlify/functions/_shared/env';

it('reads model settings and safe request bounds from the server environment', () => {
  expect(readModelConfig({
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: 'https://gateway.example.com/v1',
    OPENAI_ALLOWED_HOSTS: 'gateway.example.com',
    OPENAI_MODEL: 'configured-model',
  })).toEqual({
    apiKey: 'test-key', baseURL: 'https://gateway.example.com/v1', model: 'configured-model',
    requestTimeoutMs: 45_000, maxResponseBytes: 524_288, maxOutputTokens: 2_000, maxRetryDelayMs: 60_000,
  });
});

it('requires an explicit aggregate threshold in production', () => {
  expect(() => readAggregateSampleSize(undefined, true)).toThrow(/显式配置/);
  expect(readAggregateSampleSize(undefined, false)).toBe(3);
});
