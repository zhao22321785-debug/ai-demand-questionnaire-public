import { ZodError } from 'zod';

export function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof Response) return error;
  if (error instanceof ZodError) return jsonResponse({ error: '请求格式无效' }, { status: 400 });
  return jsonResponse({ error: '服务暂时无法处理该请求' }, { status: 500 });
}

export async function readJsonBody(request: Request, maxBytes = 16_384): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Response('请求体过大', { status: 413 });
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Response('请求体过大', { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Response('请求格式无效', { status: 400 });
  }
}
