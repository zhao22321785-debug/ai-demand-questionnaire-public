import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  PreviewSeedStageError,
  buildPreviewSeed,
  formatPreviewSeedSummary,
  requestInternalJson,
  runPreviewSeedOrchestration,
  selectPreviewSeedUsers,
  validateAcceptedInternalResponse,
  validateAnalysisResults,
  validatePreviewSeedPreflight,
  validatePreviewTarget,
  validateSupabaseTarget,
  waitForVerifiedAggregate,
} from './preview-seed-data.mjs';

const REQUIRED_ENV = [
  'PREVIEW_SEED_SUPABASE_URL',
  'PREVIEW_SEED_PUBLISHABLE_KEY',
  'PREVIEW_SEED_SERVICE_KEY',
  'PREVIEW_SEED_PREVIEW_URL',
  'PREVIEW_SEED_INTERNAL_SECRET',
];
const AUTH_PAGE_SIZE = 1_000;
const MAX_AUTH_PAGES = 100;
const ANALYSIS_DEADLINE_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

function readConfiguration() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) throw new Error(`缺少必需环境变量：${missing.join(', ')}`);
  if (process.argv.length > 2) throw new Error('预览数据命令不接受命令行参数');
  return {
    supabaseUrl: validateSupabaseTarget(process.env.PREVIEW_SEED_SUPABASE_URL.trim()),
    publishableKey: process.env.PREVIEW_SEED_PUBLISHABLE_KEY.trim(),
    serviceKey: process.env.PREVIEW_SEED_SERVICE_KEY.trim(),
    previewOrigin: validatePreviewTarget(process.env.PREVIEW_SEED_PREVIEW_URL.trim()),
    internalSecret: process.env.PREVIEW_SEED_INTERNAL_SECRET.trim(),
  };
}

function createSupabaseClients(config) {
  const auth = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  };
  return {
    publicClient: createClient(config.supabaseUrl, config.publishableKey, { auth }),
    serviceClient: createClient(config.supabaseUrl, config.serviceKey, { auth }),
  };
}

function assertResult(result, action) {
  if (result.error) {
    const code = result.error.code ? `（错误码 ${result.error.code}）` : '';
    throw new Error(`${action}失败${code}`);
  }
  return result.data;
}

async function listAllAuthUsers(serviceClient) {
  const users = [];
  for (let page = 1; page <= MAX_AUTH_PAGES; page += 1) {
    const data = assertResult(
      await serviceClient.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE }),
      '读取 Auth 用户',
    );
    const pageUsers = data?.users ?? [];
    users.push(...pageUsers);
    if (pageUsers.length < AUTH_PAGE_SIZE) return users;
  }
  throw new Error(`Auth 用户超过安全分页上限 ${MAX_AUTH_PAGES * AUTH_PAGE_SIZE}，已中止`);
}

async function loadReferenceData(serviceClient) {
  const [batchResult, departmentResult, positionResult, toolResult] = await Promise.all([
    serviceClient.from('survey_batches')
      .select('id,name,employee_survey_version_id,position_survey_version_id,starts_at,ends_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(2),
    serviceClient.from('departments').select('id,code,name').eq('is_active', true).order('sort_order'),
    serviceClient.from('positions').select('id,code,name').eq('is_active', true).order('sort_order'),
    serviceClient.from('ai_tool_options').select('id,code,name').eq('is_active', true).order('sort_order'),
  ]);
  const batches = assertResult(batchResult, '读取 active batch');
  const departments = assertResult(departmentResult, '读取部门字典');
  const positions = assertResult(positionResult, '读取岗位字典');
  const aiTools = assertResult(toolResult, '读取 AI 工具字典');
  if (batches.length !== 1) throw new Error(`预览环境必须恰好有一个 active batch，当前为 ${batches.length}`);
  const batch = batches[0];
  const now = Date.now();
  if ((batch.starts_at && now < Date.parse(batch.starts_at)) || (batch.ends_at && now >= Date.parse(batch.ends_at))) {
    throw new Error('active batch 不在有效填写时间窗口内');
  }
  const mapRows = (rows) => rows.map((row) => ({ id: row.id, code: row.code, label: row.name }));
  return {
    activeBatch: {
      id: batch.id,
      name: batch.name,
      employeeSurveyVersionId: batch.employee_survey_version_id,
      positionSurveyVersionId: batch.position_survey_version_id,
    },
    departments: mapRows(departments),
    positions: mapRows(positions),
    aiTools: mapRows(aiTools),
  };
}

function profileRow(userId, profile) {
  return {
    user_id: userId,
    name: profile.name,
    department_id: profile.departmentId ?? null,
    department_other: profile.departmentOther ?? null,
    position_id: profile.positionId ?? null,
    position_other: profile.positionOther ?? null,
    current_position_experience: profile.currentPositionExperience,
  };
}

function savedSubject(entry, saved) {
  if (!saved?.id || !Number.isInteger(saved.revision) || saved.revision < 1) {
    throw new Error('保存 RPC 未返回有效 subject id 与 revision');
  }
  return {
    subjectType: entry.kind === 'employee' ? 'employee_assessment' : 'position_survey',
    subjectId: saved.id,
    revision: saved.revision,
  };
}

async function createAndSaveFixture(publicClient, serviceClient, entry, recordCreatedUser) {
  const password = randomBytes(32).toString('base64url');
  const created = assertResult(await serviceClient.auth.admin.createUser({
    email: entry.email,
    password,
    email_confirm: true,
  }), '创建预览 Auth 用户');
  if (!created?.user?.id) throw new Error('创建预览 Auth 用户后未返回 user id');
  recordCreatedUser(created.user.id);

  const signedIn = assertResult(
    await publicClient.auth.signInWithPassword({ email: entry.email, password }),
    '预览用户登录',
  );
  if (signedIn?.user?.id !== created.user.id) throw new Error('登录会话与新建 Auth 用户不一致');

  assertResult(
    await publicClient.from('user_profiles').upsert(profileRow(created.user.id, entry.profile)),
    '保存预览用户资料',
  );
  const rpcName = entry.kind === 'employee' ? 'save_employee_assessment' : 'save_position_survey';
  const saved = assertResult(await publicClient.rpc(rpcName, { payload: entry.payload }), '保存预览答卷');
  return { userId: created.user.id, ...savedSubject(entry, saved) };
}

function subjectKey(subject) {
  return `${subject.subjectType}:${subject.subjectId}:${subject.revision}`;
}

async function waitForAnalysis(serviceClient, subjects) {
  const deadline = Date.now() + ANALYSIS_DEADLINE_MS;
  const expected = new Set(subjects.map(subjectKey));
  let previousSummary = '';
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const query = serviceClient.from('analysis_jobs')
      .select('id,subject_type,subject_id,revision,status,error_code')
      .in('subject_id', subjects.map((subject) => subject.subjectId))
      .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(15_000, remainingMs))));
    const rows = assertResult(await query, '轮询分析作业');
    const currentRows = rows.filter((row) => expected.has(subjectKey({
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      revision: row.revision,
    })));
    const failed = currentRows.find((row) => row.status === 'failed');
    if (failed) throw new Error(`分析作业 ${failed.id} 失败${failed.error_code ? `（错误码 ${failed.error_code}）` : ''}`);
    const stale = currentRows.find((row) => row.status === 'stale');
    if (stale) throw new Error(`分析作业 ${stale.id} 已 stale，禁止聚合`);
    const summary = ['queued', 'running', 'complete'].map((status) => (
      `${status}=${currentRows.filter((row) => row.status === status).length}`
    )).join(' ');
    if (summary !== previousSummary) {
      console.log(`分析进度 ${summary} missing=${subjects.length - currentRows.length}`);
      previousSummary = summary;
    }
    if (currentRows.length === subjects.length && currentRows.every((row) => row.status === 'complete')) {
      return { rows: currentRows, failedOrNonterminalCount: 0 };
    }
    const waitMs = Math.min(POLL_INTERVAL_MS, deadline - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  throw new Error('分析作业未在 180 秒截止时间内全部完成');
}

async function verifyAnalysisResults(serviceClient, subjects) {
  const result = await serviceClient.from('analysis_results')
    .select('subject_type,subject_id,revision,status,model_key')
    .in('subject_id', subjects.map((subject) => subject.subjectId));
  return validateAnalysisResults(assertResult(result, '核对当前分析结果'), subjects);
}

async function loadLatestAggregateRun(serviceClient, batchId) {
  const result = await serviceClient.from('aggregate_analysis_runs')
    .select('status,model_key,source_snapshot')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return assertResult(result, '核对最新聚合运行');
}

async function main() {
  const config = readConfiguration();
  validatePreviewSeedPreflight(await requestInternalJson(
    config,
    '/api/internal/preview-seed-preflight',
    { method: 'GET', timeoutMs: ANALYSIS_DEADLINE_MS },
  ));
  const { publicClient, serviceClient } = createSupabaseClients(config);
  const existingUsers = selectPreviewSeedUsers(await listAllAuthUsers(serviceClient));
  if (existingUsers.length > 0) {
    throw new Error(`已存在 ${existingUsers.length} 个固定前缀用户；create-once 命令已中止且未写入`);
  }
  const reference = await loadReferenceData(serviceClient);
  const fixtures = buildPreviewSeed(reference);

  const result = await runPreviewSeedOrchestration({
    fixtures,
    createAndSave: (fixture, recordCreatedUser) => createAndSaveFixture(
      publicClient,
      serviceClient,
      fixture,
      recordCreatedUser,
    ),
    dispatchAnalyses: async (subjects) => {
      const dispatches = await Promise.allSettled(subjects.map(async (subject) => {
        const payload = await requestInternalJson(config, '/api/internal/analyze-background', {
          body: { subjectType: subject.subjectType, subjectId: subject.subjectId, revision: subject.revision },
          timeoutMs: ANALYSIS_DEADLINE_MS,
        });
        return validateAcceptedInternalResponse(payload, 'analysis dispatch');
      }));
      const rejectedDispatches = dispatches.filter((dispatch) => dispatch.status === 'rejected');
      if (rejectedDispatches.length > 0) throw new Error(`${rejectedDispatches.length} 个分析请求未成功受理`);
      return { acceptedCount: dispatches.length };
    },
    waitForAnalysis: async (subjects) => {
      const jobs = await waitForAnalysis(serviceClient, subjects);
      const analyses = await verifyAnalysisResults(serviceClient, subjects);
      return { ...jobs, ...analyses };
    },
    aggregate: async (subjects) => {
      validateAcceptedInternalResponse(await requestInternalJson(config, '/api/internal/aggregate', {
        body: {},
        timeoutMs: ANALYSIS_DEADLINE_MS,
      }), 'aggregate dispatch');
      return waitForVerifiedAggregate(
        () => loadLatestAggregateRun(serviceClient, reference.activeBatch.id),
        subjects,
        { deadlineMs: ANALYSIS_DEADLINE_MS, pollIntervalMs: POLL_INTERVAL_MS },
      );
    },
    onSaved: (saved) => console.log(`已保存 subject ${saved.subjectId}（user ${saved.userId}）`),
  });
  const employeeResponses = fixtures.filter((fixture) => fixture.kind === 'employee').length;
  const positionResponses = fixtures.filter((fixture) => fixture.kind === 'position').length;
  console.log(formatPreviewSeedSummary({
    createdUsers: result.createdUserIds.length,
    employeeResponses,
    positionResponses,
    completeCurrentAnalysis: result.analysis.completeCount,
    failedOrNonterminalJobs: result.analysis.failedOrNonterminalCount,
    aggregateStatus: result.aggregation.status,
    aggregateTotalSourceCount: result.aggregation.totalSourceCount,
  }));
}

main().catch((error) => {
  if (error instanceof PreviewSeedStageError) {
    console.error(`预览数据生成失败：stage=${error.stage}`);
    console.error(`已创建用户 ID：${error.progress.createdUserIds.join(', ') || '无'}`);
    console.error(`已创建 subject：${error.progress.subjects.map((subject) => `${subject.subjectType}:${subject.subjectId}:${subject.revision}（user ${subject.userId}）`).join(', ') || '无'}`);
    process.exitCode = 1;
    return;
  }
  console.error(`预览数据生成失败：${error instanceof Error ? error.message : '未知错误'}`);
  process.exitCode = 1;
});
