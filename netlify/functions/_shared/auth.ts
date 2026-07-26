import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnalysisRequest } from '../../../src/types/analysis';

export interface ServerActor {
  id: string;
  role: 'user' | 'admin';
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) throw new Response('未登录', { status: 401 });
  return header.slice(7);
}

export async function authenticateRequest(request: Request, client: SupabaseClient): Promise<ServerActor> {
  const { data, error } = await client.auth.getUser(bearerToken(request));
  if (error || !data.user) throw new Response('登录状态无效', { status: 401 });
  const { data: role, error: roleError } = await client.from('user_roles').select('role,status').eq('user_id', data.user.id).single();
  if (roleError || role?.status !== 'active') throw new Response('账号不可用', { status: 403 });
  return { id: data.user.id, role: role.role as ServerActor['role'] };
}

export async function authorizeSubject(client: SupabaseClient, actor: ServerActor, analysis: AnalysisRequest): Promise<void> {
  const table = analysis.subjectType === 'employee_assessment' ? 'employee_assessments' : 'position_demand_surveys';
  let query = client.from(table).select('id').eq('id', analysis.subjectId).eq('revision', analysis.revision);
  if (actor.role !== 'admin') query = query.eq('user_id', actor.id);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Response('无权分析这份答卷', { status: 403 });
}

export async function requireRetryableAnalysis(client: SupabaseClient, analysis: AnalysisRequest): Promise<void> {
  const { data, error } = await client.from('analysis_results').select('status')
    .eq('subject_type', analysis.subjectType).eq('subject_id', analysis.subjectId).eq('revision', analysis.revision)
    .in('status', ['failed', 'stale']).maybeSingle();
  if (error || !data) throw new Response('只有失败或已过期的当前分析可以手动重试', { status: 409 });
}

export function requireAdmin(actor: ServerActor): void {
  if (actor.role !== 'admin') throw new Response('需要管理员权限', { status: 403 });
}
