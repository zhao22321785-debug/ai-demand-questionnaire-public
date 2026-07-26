import { describe, expect, it } from 'vitest';
import { validateDeployConfig } from '../../scripts/check-deploy-config.mjs';

const production = {
  CONTEXT: 'production',
  VITE_DATA_MODE: 'supabase',
  VITE_SUPABASE_URL: 'https://exampleprojectref123.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-value',
};

describe('deploy configuration gate', () => {
  it('accepts only the approved Supabase project in production', () => {
    expect(validateDeployConfig(production)).toEqual([]);
  });

  it.each([
    [{ ...production, VITE_DATA_MODE: undefined }, 'VITE_DATA_MODE'],
    [{ ...production, VITE_DATA_MODE: 'mock' }, 'VITE_DATA_MODE'],
    [{ ...production, VITE_SUPABASE_URL: 'https://other-project.supabase.co' }, 'VITE_SUPABASE_URL'],
    [{ ...production, VITE_SUPABASE_PUBLISHABLE_KEY: '   ' }, 'VITE_SUPABASE_PUBLISHABLE_KEY'],
  ])('rejects invalid production configuration without echoing the publishable key', (source, expectedName) => {
    const failures = validateDeployConfig(source);
    expect(failures.join('\n')).toContain(expectedName);
    expect(failures.join('\n')).not.toContain('test-publishable-value');
  });

  it('requires Deploy Preview to explicitly select mock or supabase', () => {
    expect(validateDeployConfig({ CONTEXT: 'deploy-preview' }).join('\n')).toContain('VITE_DATA_MODE');
    expect(validateDeployConfig({ CONTEXT: 'deploy-preview', VITE_DATA_MODE: 'mock' })).toEqual([]);
  });

  it('keeps a context-free local mock build available', () => {
    expect(validateDeployConfig({})).toEqual([]);
  });
});
