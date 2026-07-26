import { classifyModelError } from '../../netlify/functions/_shared/analysis-service';
import { ModelRequestError } from '../../netlify/functions/_shared/openai-model-client';

it.each([408, 429, 500, 502, 503])('retries transient status %s', (status) => {
  expect(classifyModelError(new ModelRequestError('temporary', 'http_error', status))).toBe('retryable');
});

it.each([400, 401, 403, 422])('does not retry permanent status %s', (status) => {
  expect(classifyModelError(new ModelRequestError('permanent', 'http_error', status))).toBe('permanent');
});

it('retries network errors but not schema failures', () => {
  expect(classifyModelError(new ModelRequestError('network', 'network_error'))).toBe('retryable');
  expect(classifyModelError(new ModelRequestError('schema', 'schema_error'))).toBe('permanent');
});
