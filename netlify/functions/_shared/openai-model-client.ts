import type { ZodType } from 'zod';
import type {
  AggregateAnalysisInput,
  AggregateAnalysisResult,
  EmployeeAnalysisInput,
  EmployeeAnalysisResult,
  ModelClient,
  ModelConfig,
  PositionAnalysisInput,
  PositionAnalysisResult,
} from '../../../src/types/analysis';
import {
  AggregateAnalysisResultSchema,
  EmployeeAnalysisResultSchema,
  PositionAnalysisResultSchema,
  aggregateResultJsonSchema,
  employeeResultJsonSchema,
  positionResultJsonSchema,
} from './analysis-schemas';
import { aggregateAnalysisPrompt } from './prompts/aggregate';
import { employeeAnalysisPrompt } from './prompts/employee';
import { positionAnalysisPrompt } from './prompts/position';

export class ModelRequestError extends Error {
  constructor(
    message: string,
    public readonly code: 'http_error' | 'refusal' | 'empty_output' | 'schema_error' | 'network_error' | 'timeout' | 'response_too_large' | 'redirect_error',
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ModelRequestError';
  }
}

type JsonSchema = Record<string, unknown>;

interface ResponsePayload {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RESPONSE_BYTES = 524_288;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

async function readJsonWithLimit(response: Response, maxBytes: number): Promise<ResponsePayload> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ModelRequestError('模型响应超过大小限制', 'response_too_large');
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ModelRequestError('模型响应超过大小限制', 'response_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as ResponsePayload;
  } catch {
    return {};
  }
}

function retryAfterSeconds(response: Response, maxDelayMs: number): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const numeric = Number(raw);
  const requestedMs = Number.isFinite(numeric)
    ? Math.max(0, numeric * 1_000)
    : Math.max(0, Date.parse(raw) - Date.now());
  if (!Number.isFinite(requestedMs)) return undefined;
  return Math.ceil(Math.min(requestedMs, maxDelayMs) / 1_000);
}

function extractText(payload: ResponsePayload): string {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'refusal') throw new ModelRequestError(content.refusal || '模型拒绝处理该输入', 'refusal');
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  throw new ModelRequestError('模型没有返回结构化文本', 'empty_output');
}

export class OpenAIModelClient implements ModelClient {
  private readonly endpoint: string;

  constructor(private readonly config: ModelConfig, private readonly fetcher: typeof fetch = fetch) {
    const baseURL = (config.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.endpoint = `${baseURL}/responses`;
  }

  private async generate<T>(name: string, prompt: string, input: unknown, jsonSchema: JsonSchema, schema: ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          store: false,
          max_output_tokens: this.config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          input: [
            { role: 'system', content: [{ type: 'input_text', text: prompt }] },
            { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] },
          ],
          text: { format: { type: 'json_schema', name, strict: true, schema: jsonSchema } },
        }),
      });
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted) throw new ModelRequestError('模型请求超时', 'timeout', undefined, undefined, { cause: error });
      throw new ModelRequestError('模型服务网络请求失败', 'network_error', undefined, undefined, { cause: error });
    }

    let payload: ResponsePayload;
    try {
      payload = await readJsonWithLimit(response, this.config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
    } catch (error) {
      if (controller.signal.aborted) throw new ModelRequestError('模型请求超时', 'timeout', undefined, undefined, { cause: error });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ModelRequestError('模型服务返回重定向，已拒绝跟随', 'redirect_error', response.status);
    }
    if (!response.ok) {
      throw new ModelRequestError(
        `模型服务返回 ${response.status}`,
        'http_error',
        response.status,
        retryAfterSeconds(response, this.config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS),
      );
    }

    const text = extractText(payload);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new ModelRequestError('模型结果不是有效 JSON', 'schema_error', undefined, undefined, { cause: error });
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ModelRequestError('模型结果不符合结构化协议', 'schema_error');
    }
    return parsed.data;
  }

  generateEmployeeAnalysis(input: EmployeeAnalysisInput): Promise<EmployeeAnalysisResult> {
    return this.generate('employee_analysis', employeeAnalysisPrompt, input, employeeResultJsonSchema, EmployeeAnalysisResultSchema);
  }

  generatePositionAnalysis(input: PositionAnalysisInput): Promise<PositionAnalysisResult> {
    return this.generate('position_analysis', positionAnalysisPrompt, input, positionResultJsonSchema, PositionAnalysisResultSchema);
  }

  generateAggregateAnalysis(input: AggregateAnalysisInput): Promise<AggregateAnalysisResult> {
    return this.generate('aggregate_analysis', aggregateAnalysisPrompt, input, aggregateResultJsonSchema, AggregateAnalysisResultSchema);
  }
}

export function createOpenAIModelClient(config: ModelConfig, fetcher?: typeof fetch): ModelClient {
  return new OpenAIModelClient(config, fetcher);
}
