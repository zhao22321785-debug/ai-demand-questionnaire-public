import { createRuntimeModelFactory } from '../../netlify/functions/_shared/runtime-model';

const openAIEnv = {
  ANALYSIS_MODEL_MODE: 'openai',
  OPENAI_API_KEY: 'test-only-key',
  OPENAI_MODEL: 'test-model',
};

it('uses the deterministic model only in non-production preview mode', async () => {
  const runtime = createRuntimeModelFactory({ ANALYSIS_MODEL_MODE: 'mock' }, false);

  expect(runtime.modelKey).toBe('deterministic-mock');
  expect(runtime.createModel()).toBeDefined();
});

it('rejects mock mode in production', () => {
  expect(() => createRuntimeModelFactory({ ANALYSIS_MODEL_MODE: 'mock' }, true))
    .toThrow(/production.*mock|mock.*production/i);
});

it('keeps OpenAI as the default and requires its configuration', () => {
  expect(() => createRuntimeModelFactory({}, false)).toThrow(/OPENAI_API_KEY/);

  const runtime = createRuntimeModelFactory(openAIEnv, false);
  expect(runtime.modelKey).toBe('test-model');
  expect(runtime.createModel()).toBeDefined();
});

it('rejects unknown model modes', () => {
  expect(() => createRuntimeModelFactory({ ANALYSIS_MODEL_MODE: 'unexpected' }, false))
    .toThrow(/ANALYSIS_MODEL_MODE/);
});
