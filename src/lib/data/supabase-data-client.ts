import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminResponseListFilters, AnalysisRetryAccepted, SurveyDataClient } from './contracts';
import { AppError } from '../errors';
import type {
  AnalysisStatus,
  EmployeeResponseRecord,
  EmployeeSurveyInput,
  OptionItem,
  PositionResponseRecord,
  PositionSurveyInput,
  ReferenceData,
  ResponseSummary,
  SavedResponse,
  SurveyResponseRecord,
  UserProfileInput,
} from '../../types/survey';
import type {
  AdminDashboardDto,
  AnalysisRecord,
  AnalysisRequest,
  SingleAnalysisResult,
  SubjectType,
} from '../../types/analysis';

interface ResponseRow {
  id: string;
  user_id: string;
  batch_id: string;
  revision: number;
  analysis_status: AnalysisStatus;
  submitted_at: string;
  updated_at: string;
  response_payload: unknown;
  position_key?: string;
}

interface ReferenceRow { id: string; code: string; name: string; }
interface BatchRow {
  id: string;
  name: string;
  employee_survey_version_id: string;
  position_survey_version_id: string;
}

interface AnalysisRow {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  revision: number;
  status: AnalysisRecord['status'];
  result_payload: SingleAnalysisResult | null;
  attempt_count: number;
  error_code: string | null;
  error_summary: string | null;
  model_key: string | null;
  prompt_version: string;
  created_at: string;
  updated_at: string;
}

function fail(operation: string, error: unknown): never {
  throw new AppError(`${operation}失败`, 'SUPABASE_REQUEST_FAILED', error);
}

function toEmployeeRecord(row: ResponseRow): EmployeeResponseRecord {
  const input = row.response_payload as EmployeeSurveyInput;
  return {
    id: row.id,
    userId: row.user_id,
    batchId: row.batch_id,
    revision: row.revision,
    analysisStatus: row.analysis_status,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    type: 'employee',
    input: {
      ...input,
      aiToolIds: input.aiToolOther && !input.aiToolIds.includes('other')
        ? [...input.aiToolIds, 'other']
        : input.aiToolIds,
      profile: {
        ...input.profile,
        departmentId: input.profile.departmentId ?? (input.profile.departmentOther ? 'other' : undefined),
        positionId: input.profile.positionId ?? (input.profile.positionOther ? 'other' : undefined),
      },
    },
  };
}

function toPositionRecord(row: ResponseRow): PositionResponseRecord {
  const input = row.response_payload as PositionSurveyInput;
  return {
    id: row.id,
    userId: row.user_id,
    batchId: row.batch_id,
    revision: row.revision,
    analysisStatus: row.analysis_status,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    type: 'position',
    positionKey: row.position_key ?? '',
    input: {
      ...input,
      departmentId: input.departmentId ?? (input.departmentOther ? 'other' : undefined),
      positionId: input.positionId ?? (input.positionOther ? 'other' : undefined),
    },
  };
}

function toSummary(record: SurveyResponseRecord): ResponseSummary {
  if (record.type === 'employee') {
    return {
      id: record.id,
      type: 'employee',
      title: '员工需求调研',
      subtitle: record.input.profile.positionOther || record.input.profile.name,
      revision: record.revision,
      analysisStatus: record.analysisStatus,
      submittedAt: record.submittedAt,
    };
  }
  return {
    id: record.id,
    type: 'position',
    title: record.input.positionName,
    subtitle: '岗位需求调研',
    revision: record.revision,
    analysisStatus: record.analysisStatus,
    submittedAt: record.submittedAt,
  };
}

function matchesFilters(record: SurveyResponseRecord, filters: AdminResponseListFilters): boolean {
  if (filters.batchId && record.batchId !== filters.batchId) return false;
  if (filters.analysisStatus && record.analysisStatus !== filters.analysisStatus) return false;
  if (filters.experience) {
    const experience = record.type === 'employee'
      ? record.input.profile.currentPositionExperience
      : record.input.relatedPositionExperience;
    if (experience !== filters.experience) return false;
  }
  if (filters.departmentId) {
    const departmentId = record.type === 'employee' ? record.input.profile.departmentId : record.input.departmentId;
    if (departmentId !== filters.departmentId) return false;
  }
  if (filters.positionId) {
    const positionId = record.type === 'employee' ? record.input.profile.positionId : record.input.positionId;
    if (positionId !== filters.positionId) return false;
  }
  const text = record.type === 'employee'
    ? `${record.input.profile.name} ${record.input.profile.departmentOther ?? ''} ${record.input.profile.positionOther ?? ''}`
    : `${record.input.researcherName} ${record.input.positionName} ${record.input.departmentOther ?? ''}`;
  return !filters.query || text.toLocaleLowerCase().includes(filters.query.toLocaleLowerCase());
}

async function getUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) fail('读取登录用户', error);
  return data.user.id;
}

function toAnalysisRecord(row: AnalysisRow): AnalysisRecord {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    revision: row.revision,
    status: row.status,
    result: row.result_payload,
    attemptCount: row.attempt_count,
    errorCode: row.error_code ?? undefined,
    errorSummary: row.error_summary ?? undefined,
    modelKey: row.model_key ?? undefined,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function responseMessage(text: string): string {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : '';
  } catch {
    return text.trim();
  }
}

async function requestError(response: Response, operation: 'generic' | 'retry'): Promise<AppError> {
  const retryAfter = response.headers.get('Retry-After') ?? undefined;
  const detail = responseMessage(await response.text());
  const cause = { status: response.status, retryAfter, detail: detail || undefined };
  if (operation !== 'retry') {
    return new AppError(`服务请求失败（${response.status}）`, 'ANALYSIS_REQUEST_FAILED', cause);
  }
  if (response.status === 403) {
    return new AppError(
      `没有权限重新分析这份答卷。${detail ? `（${detail}）` : ''}`,
      'ANALYSIS_RETRY_FORBIDDEN',
      cause,
    );
  }
  if (response.status === 409) {
    return new AppError(
      detail || '当前分析状态不允许重试，请刷新后确认它仍为失败或已过期。',
      'ANALYSIS_RETRY_CONFLICT',
      cause,
    );
  }
  if (response.status === 429) {
    const wait = retryAfter && /^\d+$/.test(retryAfter) ? `${retryAfter} 秒` : retryAfter;
    return new AppError(
      wait ? `重新分析请求过于频繁，请在 ${wait}后再试。` : '重新分析请求过于频繁，请稍后再试。',
      'ANALYSIS_RETRY_RATE_LIMITED',
      cause,
    );
  }
  return new AppError(
    detail ? `重新分析请求失败（${response.status}）：${detail}` : `重新分析请求失败（${response.status}），请稍后再试。`,
    'ANALYSIS_RETRY_FAILED',
    cause,
  );
}

async function authenticatedRequest<T>(
  client: SupabaseClient,
  path: string,
  body?: unknown,
  operation: 'generic' | 'retry' = 'generic',
): Promise<T> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError('登录状态已失效', 'AUTH_REQUIRED');
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await requestError(response, operation);
  const text = await response.text();
  if (!text && response.status === 202) return { accepted: true } as T;
  return JSON.parse(text) as T;
}

export function createSupabaseDataClient(client: SupabaseClient): SurveyDataClient {
  return {
    async getReferenceData(): Promise<ReferenceData> {
      const [batchResult, departmentsResult, positionsResult, toolsResult] = await Promise.all([
        client.from('survey_batches').select('id,name,employee_survey_version_id,position_survey_version_id').eq('status', 'active').order('created_at', { ascending: false }).limit(1).single(),
        client.from('departments').select('id,code,name').eq('is_active', true).order('sort_order'),
        client.from('positions').select('id,code,name').eq('is_active', true).order('sort_order'),
        client.from('ai_tool_options').select('id,code,name').eq('is_active', true).order('sort_order'),
      ]);
      if (batchResult.error) fail('读取调研批次', batchResult.error);
      if (departmentsResult.error) fail('读取部门字典', departmentsResult.error);
      if (positionsResult.error) fail('读取岗位字典', positionsResult.error);
      if (toolsResult.error) fail('读取 AI 工具字典', toolsResult.error);

      const batch = batchResult.data as BatchRow;
      const mapOptions = (rows: unknown): OptionItem[] => (rows as ReferenceRow[]).map((row) => ({
        id: row.code === 'other' ? 'other' : row.id,
        code: row.code,
        label: row.name,
      }));
      return {
        activeBatch: {
          id: batch.id,
          name: batch.name,
          surveyVersionId: batch.employee_survey_version_id,
          employeeSurveyVersionId: batch.employee_survey_version_id,
          positionSurveyVersionId: batch.position_survey_version_id,
        },
        departments: mapOptions(departmentsResult.data),
        positions: mapOptions(positionsResult.data),
        aiTools: mapOptions(toolsResult.data),
      };
    },
    async getProfile() {
      const userId = await getUserId(client);
      const { data, error } = await client.from('user_profiles').select('*').eq('user_id', userId).maybeSingle();
      if (error) fail('读取用户资料', error);
      if (!data) return null;
      return {
        name: data.name ?? '',
        departmentId: data.department_id ?? (data.department_other ? 'other' : undefined),
        departmentOther: data.department_other ?? undefined,
        positionId: data.position_id ?? (data.position_other ? 'other' : undefined),
        positionOther: data.position_other ?? undefined,
        currentPositionExperience: data.current_position_experience,
      } as UserProfileInput;
    },
    async saveProfile(profile) {
      const userId = await getUserId(client);
      const { error } = await client.from('user_profiles').upsert({
        user_id: userId,
        name: profile.name,
        department_id: profile.departmentId === 'other' ? null : profile.departmentId ?? null,
        department_other: profile.departmentOther ?? null,
        position_id: profile.positionId === 'other' ? null : profile.positionId ?? null,
        position_other: profile.positionOther ?? null,
        current_position_experience: profile.currentPositionExperience,
      });
      if (error) fail('保存用户资料', error);
      return profile;
    },
    async saveEmployeeSurvey(input) {
      const payload: EmployeeSurveyInput = {
        ...input,
        aiToolIds: input.aiToolIds.filter((id) => id !== 'other'),
        profile: {
          ...input.profile,
          departmentId: input.profile.departmentId === 'other' ? undefined : input.profile.departmentId,
          positionId: input.profile.positionId === 'other' ? undefined : input.profile.positionId,
        },
      };
      const { data, error } = await client.rpc('save_employee_assessment', { payload });
      if (error) fail('保存员工答卷', error);
      const saved = data as SavedResponse;
      void authenticatedRequest(client, '/api/analyze', { subjectType: 'employee_assessment', subjectId: saved.id, revision: saved.revision }).catch(() => undefined);
      return saved;
    },
    async savePositionSurvey(input) {
      const payload: PositionSurveyInput = {
        ...input,
        departmentId: input.departmentId === 'other' ? undefined : input.departmentId,
        positionId: input.positionId === 'other' ? undefined : input.positionId,
      };
      const { data, error } = await client.rpc('save_position_survey', { payload });
      if (error) fail('保存岗位答卷', error);
      const saved = data as SavedResponse;
      void authenticatedRequest(client, '/api/analyze', { subjectType: 'position_survey', subjectId: saved.id, revision: saved.revision }).catch(() => undefined);
      return saved;
    },
    async listMyResponses() {
      const userId = await getUserId(client);
      const [employeeResult, positionResult] = await Promise.all([
        client.from('employee_assessments').select('*').eq('user_id', userId).order('submitted_at', { ascending: false }),
        client.from('position_demand_surveys').select('*').eq('user_id', userId).order('submitted_at', { ascending: false }),
      ]);
      if (employeeResult.error) fail('读取员工答卷', employeeResult.error);
      if (positionResult.error) fail('读取岗位答卷', positionResult.error);
      return [
        ...(employeeResult.data as ResponseRow[]).map(toEmployeeRecord),
        ...(positionResult.data as ResponseRow[]).map(toPositionRecord),
      ].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).map(toSummary);
    },
    async getEmployeeResponse(id) {
      const { data, error } = await client.from('employee_assessments').select('*').eq('id', id).maybeSingle();
      if (error) fail('读取员工答卷', error);
      return data ? toEmployeeRecord(data as ResponseRow) : null;
    },
    async getPositionResponse(id) {
      const { data, error } = await client.from('position_demand_surveys').select('*').eq('id', id).maybeSingle();
      if (error) fail('读取岗位答卷', error);
      return data ? toPositionRecord(data as ResponseRow) : null;
    },
    async listEmployeeResponses(filters = {}) {
      let query = client.from('employee_assessments').select('*');
      if (filters.batchId) query = query.eq('batch_id', filters.batchId);
      const { data, error } = await query.order('submitted_at', { ascending: false });
      if (error) fail('读取员工答卷列表', error);
      return (data as ResponseRow[]).map(toEmployeeRecord).filter((record) => matchesFilters(record, filters));
    },
    async listPositionResponses(filters = {}) {
      let query = client.from('position_demand_surveys').select('*');
      if (filters.batchId) query = query.eq('batch_id', filters.batchId);
      const { data, error } = await query.order('submitted_at', { ascending: false });
      if (error) fail('读取负责人答卷列表', error);
      return (data as ResponseRow[]).map(toPositionRecord).filter((record) => matchesFilters(record, filters));
    },
    async getAnalysis(subjectType, subjectId) {
      const { data, error } = await client.from('analysis_results').select('*')
        .eq('subject_type', subjectType).eq('subject_id', subjectId)
        .order('revision', { ascending: false }).limit(1).maybeSingle();
      if (error) fail('读取分析结果', error);
      return data ? toAnalysisRecord(data as AnalysisRow) : null;
    },
    async requestAnalysis(request: AnalysisRequest) {
      return authenticatedRequest<{ accepted: boolean }>(client, '/api/analyze', request);
    },
    async retryAnalysis(request: AnalysisRequest) {
      const result = await authenticatedRequest<unknown>(client, '/api/admin/retry-analysis', request, 'retry');
      if (!result || typeof result !== 'object' || (result as { accepted?: unknown }).accepted !== true) {
        throw new AppError('重新分析请求返回了无效结果，请稍后再试。', 'ANALYSIS_RETRY_INVALID_RESPONSE', result);
      }
      return result as AnalysisRetryAccepted;
    },
    async getAdminDashboard() {
      return authenticatedRequest<AdminDashboardDto>(client, '/api/admin/dashboard');
    },
  };
}
