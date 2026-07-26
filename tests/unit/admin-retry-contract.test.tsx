import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DataClientProvider } from '../../src/lib/data/DataClientProvider';
import type { SurveyDataClient } from '../../src/lib/data/contracts';
import { createMockDataClient } from '../../src/lib/data/mock-data-client';
import { createSupabaseDataClient } from '../../src/lib/data/supabase-data-client';
import { AppError } from '../../src/lib/errors';
import { EmployeeResponseDetailPage, EmployeeResponsesPage } from '../../src/features/admin';
import type { AnalysisJobStatus, AnalysisRecord, AnalysisRequest } from '../../src/types/analysis';
import type { EmployeeResponseRecord, ReferenceData } from '../../src/types/survey';

const now = '2026-07-24T10:00:00.000Z';
const retryRequest: AnalysisRequest = {
  subjectType: 'employee_assessment',
  subjectId: '22222222-2222-4222-8222-222222222222',
  revision: 2,
};

const reference: ReferenceData = {
  activeBatch: {
    id: 'batch-current',
    name: '当前批次',
    surveyVersionId: 'survey-v2',
    employeeSurveyVersionId: 'survey-v2',
    positionSurveyVersionId: 'survey-v2',
  },
  departments: [{ id: 'product', code: 'product', label: '产品部' }],
  positions: [{ id: 'pm', code: 'pm', label: '产品经理' }],
  aiTools: [],
};

function employeeRecord(
  id = retryRequest.subjectId,
  batchId = 'batch-current',
  name = '当前员工',
  analysisStatus: EmployeeResponseRecord['analysisStatus'] = 'failed',
): EmployeeResponseRecord {
  return {
    id,
    userId: 'user-1',
    batchId,
    revision: 2,
    analysisStatus,
    submittedAt: now,
    updatedAt: now,
    type: 'employee',
    input: {
      batchId,
      surveyVersionId: 'survey-v2',
      profile: {
        name,
        departmentId: 'product',
        positionId: 'pm',
        currentPositionExperience: '1_3',
      },
      aiUseStatus: 'never',
      nonUseReasons: ['暂时没有合适工具'],
      discontinuationReasons: [],
      aiToolIds: [],
      aiScenarios: [],
      painPoints: [],
      hasExplicitDemand: false,
      tasks: [],
      dimensions: [3, null, null, null, null, null],
    },
  };
}

function analysisRecord(status: AnalysisJobStatus, revision = 2): AnalysisRecord {
  return {
    id: 'analysis-1',
    subjectType: retryRequest.subjectType,
    subjectId: retryRequest.subjectId,
    revision,
    status,
    result: null,
    attemptCount: 3,
    errorCode: status === 'failed' ? 'MODEL_TIMEOUT' : undefined,
    errorSummary: status === 'failed' ? '模型请求超时' : undefined,
    promptVersion: 'single-v1',
    createdAt: now,
    updatedAt: now,
  };
}

function renderEmployeeDetail(client: SurveyDataClient) {
  return render(
    <DataClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/employee-responses/${retryRequest.subjectId}`]}>
        <Routes>
          <Route path="/admin/employee-responses/:id" element={<EmployeeResponseDetailPage />} />
        </Routes>
      </MemoryRouter>
    </DataClientProvider>,
  );
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function detailClient(analysis: AnalysisRecord, retryAnalysis = vi.fn().mockResolvedValue({ accepted: true })) {
  const getAnalysis = vi.fn().mockResolvedValue(analysis);
  const client = {
    getReferenceData: vi.fn().mockResolvedValue(reference),
    getEmployeeResponse: vi.fn().mockResolvedValue(employeeRecord()),
    getAnalysis,
    retryAnalysis,
  } as unknown as SurveyDataClient;
  return { client, getAnalysis, retryAnalysis };
}

function supabaseClientForRequests(): SupabaseClient {
  return {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }) },
  } as unknown as SupabaseClient;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('等待 active batch 后显式按 batchId 加载，且不展示历史批次记录', async () => {
  let resolveReference!: (value: ReferenceData) => void;
  const referencePromise = new Promise<ReferenceData>((resolve) => { resolveReference = resolve; });
  const listEmployeeResponses = vi.fn().mockResolvedValue([
    employeeRecord('history-response', 'batch-history', '历史员工'),
    employeeRecord(),
  ]);
  const client = {
    getReferenceData: vi.fn().mockReturnValue(referencePromise),
    listEmployeeResponses,
  } as unknown as SurveyDataClient;

  render(<DataClientProvider client={client}><MemoryRouter><EmployeeResponsesPage /></MemoryRouter></DataClientProvider>);

  expect(listEmployeeResponses).not.toHaveBeenCalled();
  expect(screen.queryByText('历史员工')).not.toBeInTheDocument();

  await act(async () => resolveReference(reference));

  expect(await screen.findByText('当前员工')).toBeInTheDocument();
  expect(screen.queryByText('历史员工')).not.toBeInTheDocument();
  expect(listEmployeeResponses).toHaveBeenCalledWith({ analysisStatus: undefined, batchId: 'batch-current' });
});

it('mock retryAnalysis 与 Production 一样返回 accepted 契约', async () => {
  const record = employeeRecord();
  window.localStorage.setItem('ai-demand-questionnaire:m1', JSON.stringify({
    profile: null,
    responses: [record],
    analyses: [analysisRecord('failed')],
  }));
  const client = createMockDataClient();

  await expect(client.retryAnalysis(retryRequest)).resolves.toEqual({ accepted: true });
  await expect(client.getAnalysis(retryRequest.subjectType, retryRequest.subjectId)).resolves.toMatchObject({ status: 'complete', revision: 2 });
});

it('Production retryAnalysis 接受 202 accepted 响应', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: { 'content-type': 'application/json' },
  }));

  await expect(createSupabaseDataClient(supabaseClientForRequests()).retryAnalysis(retryRequest)).resolves.toEqual({ accepted: true });
});

it('Production 列表查询把 batchId 下推到两类数据库查询', async () => {
  const queries: Array<{ table: string; eq: ReturnType<typeof vi.fn> }> = [];
  const client = {
    from: vi.fn((table: string) => {
      const query = {
        table,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      queries.push(query);
      return query;
    }),
  } as unknown as SupabaseClient;
  const dataClient = createSupabaseDataClient(client);

  await dataClient.listEmployeeResponses({ batchId: 'batch-current' });
  await dataClient.listPositionResponses({ batchId: 'batch-current' });

  expect(queries).toHaveLength(2);
  expect(queries[0].eq).toHaveBeenCalledWith('batch_id', 'batch-current');
  expect(queries[1].eq).toHaveBeenCalledWith('batch_id', 'batch-current');
});

it('Production 429 保留状态和 Retry-After，并生成可直接展示的等待提示', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('请求过于频繁', {
    status: 429,
    headers: { 'Retry-After': '42' },
  }));

  const error = await createSupabaseDataClient(supabaseClientForRequests()).retryAnalysis(retryRequest).catch((caught) => caught);

  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({
    code: 'ANALYSIS_RETRY_RATE_LIMITED',
    cause: { status: 429, retryAfter: '42' },
  });
  expect(error.message).toMatch(/42 秒后再试/);
});

it.each([
  [403, '需要管理员权限', 'ANALYSIS_RETRY_FORBIDDEN', /没有权限重新分析/],
  [409, '只有失败或已过期的当前分析可以手动重试', 'ANALYSIS_RETRY_CONFLICT', /只有失败或已过期/],
  [500, '服务暂时无法处理该请求', 'ANALYSIS_RETRY_FAILED', /重新分析请求失败/],
] as const)('Production %s 返回清晰的重试失败原因', async (status, body, code, message) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status }));

  const error = await createSupabaseDataClient(supabaseClientForRequests()).retryAnalysis(retryRequest).catch((caught) => caught);

  expect(error).toMatchObject({ code, cause: { status } });
  expect(error.message).toMatch(message);
});

it.each(['failed', 'stale'] as const)('当前 revision 的 %s 分析显示管理员重新分析入口', async (status) => {
  const { client } = detailClient(analysisRecord(status));
  renderEmployeeDetail(client);

  expect(await screen.findByRole('button', { name: '重新分析' })).toBeInTheDocument();
  expect(screen.getByText('答卷版本：2')).toBeInTheDocument();
  if (status === 'failed') expect(screen.getByText('失败代码：MODEL_TIMEOUT')).toBeInTheDocument();
  expect(screen.queryByText(/原始答卷仍可查看和修改/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑|保存|审批/ })).not.toBeInTheDocument();
});

it('管理员点击重新分析后显示已受理并刷新分析状态', async () => {
  const retryAnalysis = vi.fn().mockResolvedValue({ accepted: true });
  const { client, getAnalysis } = detailClient(analysisRecord('failed'), retryAnalysis);
  getAnalysis.mockResolvedValueOnce(analysisRecord('failed')).mockResolvedValueOnce(analysisRecord('queued'));
  renderEmployeeDetail(client);

  await userEvent.click(await screen.findByRole('button', { name: '重新分析' }));

  expect(await screen.findByRole('heading', { name: '重新分析已受理' })).toBeInTheDocument();
  expect(retryAnalysis).toHaveBeenCalledWith(retryRequest);
  await waitFor(() => expect(getAnalysis).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: '重新分析' })).not.toBeInTheDocument();
});

it('202 后即使首次仍是旧 failed，也会继续同步 queued 直至 complete', async () => {
  vi.useFakeTimers();
  const failed = analysisRecord('failed');
  const queued = { ...analysisRecord('queued'), updatedAt: '2026-07-24T10:00:02.000Z', attemptCount: 4 };
  const complete = { ...analysisRecord('complete'), updatedAt: '2026-07-24T10:00:04.000Z', attemptCount: 4 };
  const getAnalysis = vi.fn()
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce(queued)
    .mockResolvedValueOnce(complete);
  const retryAnalysis = vi.fn().mockResolvedValue({ accepted: true });
  const client = {
    getReferenceData: vi.fn().mockResolvedValue(reference),
    getEmployeeResponse: vi.fn().mockResolvedValue(employeeRecord()),
    getAnalysis,
    retryAnalysis,
  } as unknown as SurveyDataClient;

  await act(async () => { renderEmployeeDetail(client); await flushPromises(); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新分析' })); await flushPromises(); });

  expect(getAnalysis).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('heading', { name: '重新分析已受理' })).toBeInTheDocument();

  await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
  expect(getAnalysis).toHaveBeenCalledTimes(3);
  expect(screen.getByRole('heading', { name: '分析准备中' })).toBeInTheDocument();

  await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
  expect(getAnalysis).toHaveBeenCalledTimes(4);
  expect(screen.getByRole('heading', { name: '分析已更新' })).toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});

it('永久 queued 严格限制为 30 次同步请求并展示超时提示', async () => {
  vi.useFakeTimers();
  const failed = analysisRecord('failed');
  const queued = { ...analysisRecord('queued'), updatedAt: '2026-07-24T10:00:02.000Z', attemptCount: 4 };
  const getAnalysis = vi.fn().mockResolvedValueOnce(failed).mockResolvedValue(queued);
  const client = {
    getReferenceData: vi.fn().mockResolvedValue(reference),
    getEmployeeResponse: vi.fn().mockResolvedValue(employeeRecord()),
    getAnalysis,
    retryAnalysis: vi.fn().mockResolvedValue({ accepted: true }),
  } as unknown as SurveyDataClient;

  await act(async () => { renderEmployeeDetail(client); await flushPromises(); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新分析' })); await flushPromises(); });
  for (let index = 0; index < 29; index += 1) {
    await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
  }

  expect(getAnalysis).toHaveBeenCalledTimes(31);
  expect(screen.getByRole('heading', { name: '重新分析已受理，但状态同步超时' })).toBeInTheDocument();
  expect(screen.getByText(/可刷新页面查看/)).toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);

  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(getAnalysis).toHaveBeenCalledTimes(31);
});

it('accepted 后连续两次读取异常会停止并展示同步失败提示', async () => {
  vi.useFakeTimers();
  const getAnalysis = vi.fn()
    .mockResolvedValueOnce(analysisRecord('failed'))
    .mockRejectedValueOnce(new Error('temporary read error'))
    .mockRejectedValueOnce(new Error('second read error'));
  const client = {
    getReferenceData: vi.fn().mockResolvedValue(reference),
    getEmployeeResponse: vi.fn().mockResolvedValue(employeeRecord()),
    getAnalysis,
    retryAnalysis: vi.fn().mockResolvedValue({ accepted: true }),
  } as unknown as SurveyDataClient;

  await act(async () => { renderEmployeeDetail(client); await flushPromises(); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新分析' })); await flushPromises(); });
  expect(getAnalysis).toHaveBeenCalledTimes(2);

  await act(async () => { await vi.advanceTimersToNextTimerAsync(); });

  expect(getAnalysis).toHaveBeenCalledTimes(3);
  expect(screen.getByRole('heading', { name: '重新分析已受理，但状态同步失败' })).toBeInTheDocument();
  expect(screen.getByText(/可刷新页面查看/)).toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});

it('管理员详情卸载时清理 accepted 后的同步 timer', async () => {
  vi.useFakeTimers();
  const getAnalysis = vi.fn()
    .mockResolvedValueOnce(analysisRecord('failed'))
    .mockResolvedValue({ ...analysisRecord('queued'), updatedAt: '2026-07-24T10:00:02.000Z' });
  const client = {
    getReferenceData: vi.fn().mockResolvedValue(reference),
    getEmployeeResponse: vi.fn().mockResolvedValue(employeeRecord()),
    getAnalysis,
    retryAnalysis: vi.fn().mockResolvedValue({ accepted: true }),
  } as unknown as SurveyDataClient;

  let view!: ReturnType<typeof renderEmployeeDetail>;
  await act(async () => { view = renderEmployeeDetail(client); await flushPromises(); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新分析' })); await flushPromises(); });
  expect(getAnalysis).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(1);

  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(getAnalysis).toHaveBeenCalledTimes(2);
});

it('管理员重试遇到 429 时展示 Retry-After 提示并允许再次操作', async () => {
  const retryAnalysis = vi.fn().mockRejectedValue(new AppError(
    '重新分析请求过于频繁，请在 42 秒后再试。',
    'ANALYSIS_RETRY_RATE_LIMITED',
    { status: 429, retryAfter: '42' },
  ));
  const { client } = detailClient(analysisRecord('failed'), retryAnalysis);
  renderEmployeeDetail(client);

  await userEvent.click(await screen.findByRole('button', { name: '重新分析' }));

  expect(await screen.findByText(/42 秒后再试/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新分析' })).toBeEnabled();
});

it.each([
  ['complete', 2],
  ['failed', 1],
] as const)('非失败或非当前 revision 不显示重试入口：%s revision %s', async (status, revision) => {
  const { client } = detailClient(analysisRecord(status, revision));
  renderEmployeeDetail(client);

  await screen.findByText('答卷版本：2');
  await waitFor(() => expect(screen.queryByRole('heading', { name: '正在读取需求分析' })).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '重新分析' })).not.toBeInTheDocument();
  if (revision !== 2) {
    expect(screen.getByRole('heading', { name: '分析需要更新' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '分析暂未完成' })).not.toBeInTheDocument();
  }
});
