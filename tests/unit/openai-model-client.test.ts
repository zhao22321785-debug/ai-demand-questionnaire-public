import { OpenAIModelClient, ModelRequestError } from '../../netlify/functions/_shared/openai-model-client';
import type { EmployeeAnalysisInput } from '../../src/types/analysis';

const input: EmployeeAnalysisInput = {
  subjectType: 'employee_assessment', subjectId: 'response-1', revision: 1,
  respondent: { department: '技术研发', position: '研发工程师', experience: '3_5' },
  aiUseStatus: 'never', aiUseBackground: ['暂时没有发现适合的工作'], hasExplicitDemand: false,
  backgroundEvidence: { nonUseReasons: ['暂时没有发现适合的工作'], discontinuationReasons: [], aiScenarios: [], painPoints: [] },
  tasks: [], dimensions: [3, null, null, null, null, null], allowedEvidencePaths: ['aiUseStatus', 'dimensions.0'],
};

const validResult = {
  kind: 'employee', subjectId: 'response-1', revision: 1, hasExplicitDemand: false,
  summary: '本次没有明确需求', departments: ['技术研发'], positions: ['研发工程师'], aiUseBackground: ['尚未使用 AI'], scenarios: [],
  behaviorProfile: ['只记录当前行为'], dimensionNotes: ['维度 1 已记录'], disclaimer: '初步分析',
};

it('uses the configured model, structured format, bounded output and manual redirects', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(validResult) }] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const client = new OpenAIModelClient({
    apiKey: 'test-key', baseURL: 'https://gateway.example.com/v1', model: 'configured-model',
    requestTimeoutMs: 5_000, maxResponseBytes: 64_000, maxOutputTokens: 321, maxRetryDelayMs: 60_000,
  }, fetcher);
  await expect(client.generateEmployeeAnalysis(input)).resolves.toMatchObject({ kind: 'employee', scenarios: [] });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('https://gateway.example.com/v1/responses');
  const body = JSON.parse(String(init?.body));
  expect(body.model).toBe('configured-model');
  expect(body.store).toBe(false);
  expect(body.max_output_tokens).toBe(321);
  expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'employee_analysis', strict: true });
  expect(init?.redirect).toBe('manual');
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});

it('aborts a model request at the configured hard timeout', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    setTimeout(() => _resolve(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(validResult) }] }],
    }), { status: 200 })), 50);
  }));
  const client = new OpenAIModelClient({
    apiKey: 'test-key', model: 'configured-model', requestTimeoutMs: 5,
    maxResponseBytes: 64_000, maxOutputTokens: 321, maxRetryDelayMs: 60_000,
  }, fetcher);
  await expect(client.generateEmployeeAnalysis(input)).rejects.toMatchObject({ code: 'timeout' } satisfies Partial<ModelRequestError>);
});

it('rejects a response whose declared body exceeds the strict byte limit', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(128), {
    status: 200, headers: { 'content-length': '128' },
  }));
  const client = new OpenAIModelClient({
    apiKey: 'test-key', model: 'configured-model', requestTimeoutMs: 5_000,
    maxResponseBytes: 64, maxOutputTokens: 321, maxRetryDelayMs: 60_000,
  }, fetcher);
  await expect(client.generateEmployeeAnalysis(input)).rejects.toMatchObject({ code: 'response_too_large' } satisfies Partial<ModelRequestError>);
});

it('does not persist an untrusted provider error message', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'secret response excerpt' } }), {
    status: 500,
  }));
  const client = new OpenAIModelClient({ apiKey: 'test-key', model: 'configured-model' }, fetcher);
  await expect(client.generateEmployeeAnalysis(input)).rejects.toMatchObject({ code: 'http_error', message: '模型服务返回 500' });
});

it('turns a refusal into an explicit permanent error', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'cannot process' }] }],
  }), { status: 200 }));
  const client = new OpenAIModelClient({ apiKey: 'test-key', model: 'configured-model' }, fetcher);
  await expect(client.generateEmployeeAnalysis(input)).rejects.toMatchObject({ code: 'refusal' } satisfies Partial<ModelRequestError>);
});
