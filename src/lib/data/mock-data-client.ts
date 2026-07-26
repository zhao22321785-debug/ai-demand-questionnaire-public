import type { AdminResponseListFilters, SurveyDataClient } from './contracts';
import type {
  EmployeeResponseRecord,
  EmployeeSurveyInput,
  PositionResponseRecord,
  PositionSurveyInput,
  ReferenceData,
  ResponseSummary,
  SavedResponse,
  SurveyResponseRecord,
  UserProfileInput,
} from '../../types/survey';
import type { AnalysisRecord, AnalysisRequest, SubjectType } from '../../types/analysis';
import { buildEmployeeAnalysisInput, buildPositionAnalysisInput } from '../analysis/input-builders';
import { createMockModelClient } from '../analysis/mock-model-client';
import { buildMockDashboard } from '../analysis/dashboard';

const STORAGE_KEY = 'ai-demand-questionnaire:m1';
const MOCK_USER_ID = 'mock-user';

interface MockState {
  profile: UserProfileInput | null;
  responses: SurveyResponseRecord[];
  analyses: AnalysisRecord[];
}

const referenceData: ReferenceData = {
  activeBatch: {
    id: 'batch-m1',
    name: '第一轮 AI 需求调研',
    surveyVersionId: 'survey-v1',
    employeeSurveyVersionId: 'survey-v1',
    positionSurveyVersionId: 'survey-v1',
  },
  departments: [
    { id: 'product', code: 'product_operations', label: '产品与运营' },
    { id: 'technology', code: 'technology', label: '技术研发' },
    { id: 'business', code: 'business', label: '业务团队' },
    { id: 'other', code: 'other', label: '其他' },
  ],
  positions: [
    { id: 'product-manager', code: 'product_manager', label: '产品经理' },
    { id: 'engineer', code: 'engineer', label: '研发工程师' },
    { id: 'operations', code: 'operations', label: '运营' },
    { id: 'sales', code: 'sales', label: '销售' },
    { id: 'other', code: 'other', label: '其他' },
  ],
  aiTools: [
    { id: 'chatgpt', code: 'chatgpt', label: 'ChatGPT' },
    { id: 'deepseek', code: 'deepseek', label: 'DeepSeek' },
    { id: 'doubao', code: 'doubao', label: '豆包' },
    { id: 'kimi', code: 'kimi', label: 'Kimi' },
    { id: 'other', code: 'other', label: '其他' },
  ],
};

function emptyState(): MockState {
  return { profile: null, responses: [], analyses: [] };
}

function readState(): MockState {
  if (typeof window === 'undefined') return emptyState();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<MockState>;
    return { profile: parsed.profile ?? null, responses: parsed.responses ?? [], analyses: parsed.analyses ?? [] };
  } catch {
    return emptyState();
  }
}

function writeState(state: MockState): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function analyzeRecord(
  state: MockState,
  request: AnalysisRequest,
): Promise<{ state: MockState; analysis: AnalysisRecord }> {
  const record = state.responses.find((item) => item.id === request.subjectId);
  if (!record || record.revision !== request.revision) throw new Error('答卷版本不存在或已更新');
  const expectedType: SubjectType = record.type === 'employee' ? 'employee_assessment' : 'position_survey';
  if (expectedType !== request.subjectType) throw new Error('答卷类型不匹配');
  const model = createMockModelClient();
  const result = record.type === 'employee'
    ? await model.generateEmployeeAnalysis(buildEmployeeAnalysisInput(record, referenceData))
    : await model.generatePositionAnalysis(buildPositionAnalysisInput(record, referenceData));
  const now = new Date().toISOString();
  const analysis: AnalysisRecord = {
    id: createId(),
    ...request,
    status: 'complete',
    result,
    attemptCount: 1,
    modelKey: 'deterministic-mock',
    promptVersion: 'single-v1',
    createdAt: now,
    updatedAt: now,
  };
  const responses = state.responses.map((item) => item.id === record.id ? { ...item, analysisStatus: 'complete' as const } : item);
  return {
    state: {
      ...state,
      responses,
      analyses: [...state.analyses.filter((item) => !(item.subjectType === request.subjectType && item.subjectId === request.subjectId)), analysis],
    },
    analysis,
  };
}

function positionKey(input: PositionSurveyInput): string {
  if (input.positionId && input.positionId !== 'other') return `std:${input.positionId}`;
  return `other:${input.positionName.trim().toLocaleLowerCase().replace(/\s+/g, ' ')}`;
}

function toSummary(response: SurveyResponseRecord): ResponseSummary {
  if (response.type === 'employee') {
    return {
      id: response.id,
      type: 'employee',
      title: '员工需求调研',
      subtitle: response.input.profile.positionOther || response.input.profile.name,
      revision: response.revision,
      analysisStatus: response.analysisStatus,
      submittedAt: response.submittedAt,
    };
  }
  return {
    id: response.id,
    type: 'position',
    title: response.input.positionName,
    subtitle: '岗位需求调研',
    revision: response.revision,
    analysisStatus: response.analysisStatus,
    submittedAt: response.submittedAt,
  };
}

function matchesFilters(record: SurveyResponseRecord, filters: AdminResponseListFilters): boolean {
  if (filters.batchId && record.batchId !== filters.batchId) return false;
  if (filters.analysisStatus && record.analysisStatus !== filters.analysisStatus) return false;
  const searchable =
    record.type === 'employee'
      ? `${record.input.profile.name} ${record.input.profile.departmentOther ?? ''} ${record.input.profile.positionOther ?? ''}`
      : `${record.input.researcherName} ${record.input.positionName} ${record.input.departmentOther ?? ''}`;
  return !filters.query || searchable.toLocaleLowerCase().includes(filters.query.toLocaleLowerCase());
}

export function createMockDataClient(): SurveyDataClient {
  return {
    async getReferenceData() {
      return referenceData;
    },
    async getProfile() {
      return readState().profile;
    },
    async saveProfile(profile) {
      const state = readState();
      writeState({ ...state, profile });
      return profile;
    },
    async saveEmployeeSurvey(input: EmployeeSurveyInput): Promise<SavedResponse> {
      if (input.aiUseStatus === 'never' && input.tasks.some((task) => task.aiUseStatus !== 'never')) {
        throw new Error('从未使用 AI 的员工任务必须使用 never 状态');
      }
      if (input.aiUseStatus === 'never' && (input.aiToolIds.length > 0 || input.aiToolOther || input.aiScenarios.length > 0 || input.discontinuationReasons.length > 0)) {
        throw new Error('从未使用 AI 的员工答卷不能包含工具、场景或停用原因');
      }
      const state = readState();
      const existing = state.responses.find(
        (item): item is EmployeeResponseRecord =>
          item.type === 'employee' && item.batchId === input.batchId && item.userId === MOCK_USER_ID,
      );
      const now = new Date().toISOString();
      const record: EmployeeResponseRecord = {
        id: existing?.id ?? createId(),
        userId: MOCK_USER_ID,
        batchId: input.batchId,
        type: 'employee',
        input,
        revision: (existing?.revision ?? 0) + 1,
        analysisStatus: 'pending',
        submittedAt: existing?.submittedAt ?? now,
        updatedAt: now,
      };
      const nextState = { ...state, profile: input.profile, responses: [...state.responses.filter((item) => item.id !== record.id), record] };
      writeState(nextState);
      const analyzed = await analyzeRecord(nextState, { subjectType: 'employee_assessment', subjectId: record.id, revision: record.revision });
      writeState(analyzed.state);
      return { id: record.id, revision: record.revision, analysisStatus: analyzed.analysis.status === 'complete' ? 'complete' : 'pending' };
    },
    async savePositionSurvey(input: PositionSurveyInput): Promise<SavedResponse> {
      const state = readState();
      const canonicalPositionKey = positionKey(input);
      const existing = state.responses.find(
        (item): item is PositionResponseRecord =>
          item.type === 'position' &&
          item.batchId === input.batchId &&
          item.userId === MOCK_USER_ID &&
          item.positionKey === canonicalPositionKey,
      );
      const now = new Date().toISOString();
      const record: PositionResponseRecord = {
        id: existing?.id ?? createId(),
        userId: MOCK_USER_ID,
        batchId: input.batchId,
        type: 'position',
        positionKey: canonicalPositionKey,
        input,
        revision: (existing?.revision ?? 0) + 1,
        analysisStatus: 'pending',
        submittedAt: existing?.submittedAt ?? now,
        updatedAt: now,
      };
      const nextState = { ...state, responses: [...state.responses.filter((item) => item.id !== record.id), record] };
      writeState(nextState);
      const analyzed = await analyzeRecord(nextState, { subjectType: 'position_survey', subjectId: record.id, revision: record.revision });
      writeState(analyzed.state);
      return { id: record.id, revision: record.revision, analysisStatus: analyzed.analysis.status === 'complete' ? 'complete' : 'pending' };
    },
    async listMyResponses() {
      return readState().responses.filter((item) => item.userId === MOCK_USER_ID).map(toSummary);
    },
    async getEmployeeResponse(id) {
      return (
        readState().responses.find((item): item is EmployeeResponseRecord => item.type === 'employee' && item.id === id) ?? null
      );
    },
    async getPositionResponse(id) {
      return (
        readState().responses.find((item): item is PositionResponseRecord => item.type === 'position' && item.id === id) ?? null
      );
    },
    async listEmployeeResponses(filters = {}) {
      return readState().responses.filter(
        (item): item is EmployeeResponseRecord => item.type === 'employee' && matchesFilters(item, filters),
      );
    },
    async listPositionResponses(filters = {}) {
      return readState().responses.filter(
        (item): item is PositionResponseRecord => item.type === 'position' && matchesFilters(item, filters),
      );
    },
    async getAnalysis(subjectType: SubjectType, subjectId: string) {
      return readState().analyses.find((item) => item.subjectType === subjectType && item.subjectId === subjectId) ?? null;
    },
    async requestAnalysis(request: AnalysisRequest) {
      const state = readState();
      const existing = state.analyses.find((item) => item.subjectType === request.subjectType && item.subjectId === request.subjectId && item.revision === request.revision && item.status === 'complete');
      if (existing) return { accepted: true };
      const analyzed = await analyzeRecord(state, request);
      writeState(analyzed.state);
      return { accepted: true };
    },
    async retryAnalysis(request: AnalysisRequest) {
      const analyzed = await analyzeRecord(readState(), request);
      writeState(analyzed.state);
      return { accepted: true };
    },
    async getAdminDashboard() {
      const state = readState();
      return buildMockDashboard(state.responses, state.analyses, referenceData);
    },
  };
}
