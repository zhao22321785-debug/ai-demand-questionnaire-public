import { envValue, isProductionRuntime } from '../../netlify/functions/_shared/runtime-env';

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as typeof globalThis & { Netlify?: unknown }).Netlify;
});

it('reads Node Function-scoped variables from process.env and ignores the Edge-only Netlify global', () => {
  vi.stubEnv('RUNTIME_ENV_TEST', 'node-function-value');
  Object.assign(globalThis, { Netlify: { env: { get: () => 'edge-value' } } });
  expect(envValue('RUNTIME_ENV_TEST')).toBe('node-function-value');
});

it('derives production mode from the Netlify Function deploy context instead of a build-only variable', () => {
  vi.stubEnv('CONTEXT', 'production');
  expect(isProductionRuntime()).toBe(false);
  expect(isProductionRuntime({ deploy: { context: 'deploy-preview' } })).toBe(false);
  expect(isProductionRuntime({ deploy: { context: 'production' } })).toBe(true);
});
