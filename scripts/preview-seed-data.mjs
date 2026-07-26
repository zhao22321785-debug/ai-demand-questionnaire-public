export const SEED_PREFIX = 'preview-seed-20260724-';
export const APPROVED_SUPABASE_PROJECT_REF = 'exampleprojectref123';
export const APPROVED_SUPABASE_HOST = `${APPROVED_SUPABASE_PROJECT_REF}.supabase.co`;
export const APPROVED_PREVIEW_HOST = 'public-preview--ai-demand-questionnaire.netlify.app';
export const PREVIEW_MODEL_KEY = 'deterministic-mock';

function targetUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} URL 无效`);
  }
}

function hasUnexpectedUrlParts(url) {
  return Boolean(url.username || url.password || url.pathname !== '/' || url.search || url.hash);
}

export function validateSupabaseTarget(value) {
  const url = targetUrl(value, 'Supabase');
  if (url.protocol !== 'https:' || url.hostname !== APPROVED_SUPABASE_HOST || url.port || hasUnexpectedUrlParts(url)) {
    throw new Error(`Supabase 目标必须精确为 https://${APPROVED_SUPABASE_HOST}`);
  }
  return url.origin;
}

export function validatePreviewTarget(value) {
  const url = targetUrl(value, 'Preview');
  const approved = url.protocol === 'https:'
    && url.hostname === APPROVED_PREVIEW_HOST
    && !url.port;
  if (!approved || hasUnexpectedUrlParts(url)) {
    throw new Error(`Preview 目标必须精确为 https://${APPROVED_PREVIEW_HOST}`);
  }
  return url.origin;
}

export function selectPreviewSeedUsers(users) {
  return users.filter((user) => user.email?.startsWith(SEED_PREFIX));
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export async function requestInternalJson(config, path, {
  method = 'POST',
  body,
  fetcher = fetch,
  timeoutMs = 180_000,
} = {}) {
  let response;
  try {
    response = await fetcher(new URL(path, config.previewOrigin).toString(), {
      method,
      headers: {
        'content-type': 'application/json',
        'x-analysis-secret': config.internalSecret,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`${path} 网络调用失败或超时`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${path} 返回重定向 HTTP ${response.status}，已拒绝跟随`);
  }
  if (!response.ok) throw new Error(`${path} 返回 HTTP ${response.status}`);
  const text = await response.text();
  if (!text && response.status === 202) return { accepted: true };
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} 未返回有效 JSON`);
  }
}

export function validateAcceptedInternalResponse(payload, label) {
  const value = objectValue(payload);
  if (!value || value.accepted !== true) throw new Error(`${label} 响应 accepted 必须为 true`);
  return value;
}

export function validateAggregateResponse(payload) {
  const value = validateAcceptedInternalResponse(payload, 'aggregate');
  if (value.result !== 'updated') throw new Error('aggregate 响应 result 必须为 updated');
  return { accepted: true, result: 'updated' };
}

export function validatePreviewSeedPreflight(payload) {
  const value = validateAcceptedInternalResponse(payload, 'preview seed preflight');
  if (!['branch-deploy', 'deploy-preview'].includes(value.deployContext)) {
    throw new Error('preview seed preflight 必须来自 branch-deploy 或 deploy-preview');
  }
  if (value.supabaseProjectRef !== APPROVED_SUPABASE_PROJECT_REF || value.supabaseHost !== APPROVED_SUPABASE_HOST) {
    throw new Error(`preview seed preflight 必须使用 Supabase 项目 ${APPROVED_SUPABASE_PROJECT_REF}`);
  }
  if (value.modelKey !== PREVIEW_MODEL_KEY) {
    throw new Error(`preview seed preflight 模型必须为 ${PREVIEW_MODEL_KEY}`);
  }
  return {
    accepted: true,
    deployContext: value.deployContext,
    supabaseProjectRef: value.supabaseProjectRef,
    supabaseHost: value.supabaseHost,
    modelKey: value.modelKey,
  };
}

function subjectKey(subject) {
  return `${subject.subjectType}:${subject.subjectId}:${subject.revision}`;
}

function rowSubjectKey(row) {
  return subjectKey({
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    revision: row.revision,
  });
}

export function validateAnalysisResults(rows, subjects) {
  const expected = new Set(subjects.map(subjectKey));
  const corresponding = rows.filter((row) => expected.has(rowSubjectKey(row)));
  for (const subject of subjects) {
    const key = subjectKey(subject);
    const matches = corresponding.filter((row) => rowSubjectKey(row) === key);
    if (matches.length !== 1) throw new Error(`当前分析结果缺少或重复：${key}`);
    const [row] = matches;
    if (row.status !== 'complete') throw new Error(`当前分析结果未 complete：${key}`);
    if (row.model_key !== PREVIEW_MODEL_KEY) throw new Error(`当前分析结果模型必须为 ${PREVIEW_MODEL_KEY}：${key}`);
  }
  return { completeCount: subjects.length };
}

export function validateAggregateRun(row, subjects) {
  const value = objectValue(row);
  if (!value || value.status !== 'complete') throw new Error('最新聚合运行必须为 complete');
  if (value.model_key !== PREVIEW_MODEL_KEY) throw new Error(`最新聚合运行模型必须为 ${PREVIEW_MODEL_KEY}`);
  if (!Array.isArray(value.source_snapshot)) throw new Error('最新聚合运行 source_snapshot 无效');
  const sources = value.source_snapshot.filter((source) => (
    objectValue(source)
    && typeof source.subjectType === 'string'
    && typeof source.subjectId === 'string'
    && Number.isInteger(source.revision)
  ));
  const sourceKeys = new Set(sources.map(subjectKey));
  const missing = subjects.map(subjectKey).filter((key) => !sourceKeys.has(key));
  if (missing.length > 0) throw new Error(`最新聚合运行缺少 ${missing.length} 个 seeded source`);
  return { status: 'complete', totalSourceCount: sources.length };
}

export async function waitForVerifiedAggregate(loadLatest, subjects, {
  deadlineMs = 180_000,
  pollIntervalMs = 2_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const row = await loadLatest();
    if (row?.status === 'failed') throw new Error('最新聚合运行失败');
    if (row?.status === 'complete') return validateAggregateRun(row, subjects);
    const waitMs = Math.min(pollIntervalMs, deadline - Date.now());
    if (waitMs > 0) await sleep(waitMs);
  }
  throw new Error('聚合运行未在截止时间内完成');
}

export function formatPreviewSeedSummary({
  createdUsers,
  employeeResponses,
  positionResponses,
  completeCurrentAnalysis,
  failedOrNonterminalJobs,
  aggregateStatus,
  aggregateTotalSourceCount,
}) {
  return [
    `created_users=${createdUsers}`,
    `employee_responses=${employeeResponses}`,
    `position_responses=${positionResponses}`,
    `complete_current_analysis=${completeCurrentAnalysis}`,
    `failed_or_nonterminal_jobs=${failedOrNonterminalJobs}`,
    `aggregate_status=${aggregateStatus}`,
    `aggregate_total_source_count=${aggregateTotalSourceCount}`,
  ].join('\n');
}

export class PreviewSeedStageError extends Error {
  constructor(stage, progress) {
    super(`预览数据在 ${stage} 阶段失败；已保留本次创建的数据`);
    this.name = 'PreviewSeedStageError';
    this.stage = stage;
    this.progress = {
      createdUserIds: [...progress.createdUserIds],
      subjects: progress.subjects.map((subject) => ({
        userId: subject.userId,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        revision: subject.revision,
      })),
    };
  }
}

export async function runPreviewSeedOrchestration({
  fixtures,
  createAndSave,
  dispatchAnalyses,
  waitForAnalysis,
  aggregate,
  onSaved,
}) {
  const createdUserIds = [];
  const subjects = [];
  let stage = 'save';
  const recordCreatedUser = (userId) => {
    if (!createdUserIds.includes(userId)) createdUserIds.push(userId);
  };
  try {
    for (const fixture of fixtures) {
      const subject = await createAndSave(fixture, recordCreatedUser);
      subjects.push(subject);
      onSaved?.(subject);
    }
    stage = 'dispatch';
    const dispatch = await dispatchAnalyses(subjects);
    stage = 'analysis';
    const analysis = await waitForAnalysis(subjects);
    stage = 'aggregate';
    const aggregation = await aggregate(subjects);
    return { createdUserIds, subjects, dispatch, analysis, aggregation };
  } catch {
    throw new PreviewSeedStageError(stage, { createdUserIds, subjects });
  }
}

const employeeThemes = [
  {
    title: '整理用户访谈记录',
    process: '访谈结束后逐段回听录音并把原话复制到主题表格',
    problem: '一次六十分钟访谈通常需要两小时整理，原话出处容易在合并时丢失',
    support: '按主题归类原话并保留时间点，供产品经理逐条核对',
    scenario: '访谈记录整理',
  },
  {
    title: '定位开发环境故障',
    process: '先比对日志和最近提交，再在本地逐项复现依赖与配置差异',
    problem: '跨服务日志分散，相同故障经常重复排查',
    support: '汇总日志线索并生成带证据位置的排查清单',
    scenario: '开发故障排查',
  },
  {
    title: '补充回归测试用例',
    process: '依据需求说明和历史缺陷手工拆分正常、异常与边界用例',
    problem: '版本临近提测时容易漏掉历史缺陷对应的回归条件',
    support: '基于需求与缺陷记录生成候选用例，由测试人员复核',
    scenario: '测试用例生成',
  },
  {
    title: '审阅需求文档',
    process: '逐段检查术语、范围、验收条件与前后章节的一致性',
    problem: '多人修改后矛盾点隐藏在不同章节，评审前发现较晚',
    support: '标出冲突段落和缺失验收条件，不自动改写原文',
    scenario: '文档审阅',
  },
  {
    title: '整理跨团队交接材料',
    process: '从工单、群聊和发布记录中人工汇总接口变化与待办责任人',
    problem: '信息来源分散，接手团队难以确认最新状态和证据出处',
    support: '生成含来源链接、负责人和未决项的交接草稿',
    scenario: '跨团队交接',
  },
  {
    title: '分析自动化测试失败',
    process: '按失败用例逐条查看截图、请求日志和最近构建差异',
    problem: '环境抖动与真实回归混在一起，重复分类占用时间',
    support: '按相似证据聚类失败并建议复核顺序',
    scenario: '测试失败归类',
  },
  {
    title: '核对接口变更影响',
    process: '对照接口文档、调用方清单和代码搜索结果逐项确认影响范围',
    problem: '调用关系不完整时容易遗漏跨团队兼容性风险',
    support: '形成待人工确认的调用方与兼容性检查清单',
    scenario: '接口变更审阅',
  },
];

const employeeAssignments = [
  [0, 0],
  [1, 1],
  [2, 2],
  [0, 0],
  [1, 1],
  [2, 2],
  [1, 1],
];

const employeeUsageProfiles = [
  {
    status: 'never',
    nonUseReasons: ['暂时没有找到适合当前工作的可靠用法'],
    discontinuationReasons: [],
    taskStatus: 'never',
    dimensions: [2, null, null, null, null, null],
  },
  {
    status: 'tried_rarely',
    nonUseReasons: [],
    discontinuationReasons: ['结果仍需大量人工核对，暂未持续使用'],
    taskStatus: 'stopped',
    taskAiFollowUp: '曾尝试让 AI 汇总日志，但因上下文不完整而停止持续使用',
    dimensions: [3, 2, 2, 3, 2, 2],
  },
  { status: 'sometimes', nonUseReasons: [], discontinuationReasons: [], taskStatus: 'using', dimensions: [3, 3, 2, 4, 3, 3] },
  { status: 'frequent', nonUseReasons: [], discontinuationReasons: [], taskStatus: 'using', dimensions: [4, 4, 3, 4, 4, 4] },
  { status: 'sometimes', nonUseReasons: [], discontinuationReasons: [], taskStatus: 'using', dimensions: [3, 4, 3, 3, 4, 3] },
  { status: 'frequent', nonUseReasons: [], discontinuationReasons: [], taskStatus: 'using', dimensions: [4, 3, 4, 4, 3, 4] },
  { status: 'sometimes', nonUseReasons: [], discontinuationReasons: [], taskStatus: 'using', dimensions: [2, 3, 3, 4, 3, 2] },
];

const leaderThemes = [
  {
    work: '需求调研与评审',
    secondaryWork: '版本范围确认',
    task: '形成可追溯的访谈结论',
    input: '访谈录音、原始笔记和需求背景',
    output: '带原话出处的主题摘要与待确认问题',
    process: '负责人合并多名员工的访谈笔记，再回看原始记录核对结论',
    problem: '主题合并耗时，交接时难以快速定位结论对应的原始证据',
    support: '按主题整理候选结论并保留原话出处，由负责人确认后使用',
  },
  {
    work: '研发交付与故障处理',
    secondaryWork: '跨团队接口交接',
    task: '整理故障定位与交接信息',
    input: '服务日志、提交记录、接口变更说明和工单',
    output: '排查证据、影响调用方和待办责任人清单',
    process: '负责人从多个系统收集线索，组织研发逐项复现后再同步调用方',
    problem: '排障和交接材料分散，重复询问影响恢复与发布节奏',
    support: '汇总可追溯线索与未决项，不替代研发人员判断故障根因',
  },
  {
    work: '测试方案与回归管理',
    secondaryWork: '质量报告审阅',
    task: '补齐测试用例并审阅失败证据',
    input: '需求验收标准、历史缺陷、失败截图和请求日志',
    output: '候选回归用例、失败分类和人工复核记录',
    process: '负责人先拆分风险，再由测试人员编写用例并逐条复核失败证据',
    problem: '时间紧时边界用例和历史缺陷容易遗漏，失败分类也存在重复劳动',
    support: '生成候选用例并按证据聚类失败，最终结论由测试负责人确认',
  },
];

function requireRows(reference, key, count) {
  const rows = reference?.[key]?.filter((row) => row?.id && row.code !== 'other') ?? [];
  if (rows.length < count) throw new Error(`预览数据至少需要 ${count} 条可用 ${key} 记录`);
  return rows.slice(0, count);
}

function deterministicUuid(sequence) {
  return `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function employeeEntry(index, reference, departments, positions, tools) {
  const number = index + 1;
  const [departmentIndex, positionIndex] = employeeAssignments[index];
  const usage = employeeUsageProfiles[index];
  const profile = {
    name: `预览员工 ${String(number).padStart(2, '0')}`,
    departmentId: departments[departmentIndex].id,
    positionId: positions[positionIndex].id,
    currentPositionExperience: ['1_3', '3_5', '1_3', '5_10', '3_5', '5_10', 'over_10'][index],
  };
  const theme = employeeThemes[index];
  return {
    email: `${SEED_PREFIX}employee-${String(number).padStart(2, '0')}@example.com`,
    kind: 'employee',
    profile,
    payload: {
      batchId: reference.activeBatch.id,
      surveyVersionId: reference.activeBatch.employeeSurveyVersionId,
      profile,
      aiUseStatus: usage.status,
      nonUseReasons: usage.nonUseReasons,
      discontinuationReasons: usage.discontinuationReasons,
      aiToolIds: usage.status === 'never' ? [] : [tools[index % tools.length].id],
      aiScenarios: usage.status === 'never' ? [] : [theme.scenario],
      painPoints: [theme.problem],
      hasExplicitDemand: true,
      tasks: [{
        id: deterministicUuid(100 + number),
        title: theme.title,
        currentProcess: theme.process,
        mainProblem: theme.problem,
        occurrence: index % 2 === 0 ? 'weekly' : 'project_event',
        stability: index % 2 === 0 ? 'partly_fixed' : 'variable',
        audience: index === 4 || index === 6 ? 'cross_function' : 'same_position',
        aiUseStatus: usage.taskStatus,
        aiFollowUp: usage.status === 'never'
          ? undefined
          : usage.taskAiFollowUp ?? '已尝试通用 AI，但仍需人工核对来源与业务约束',
        expectedSupport: theme.support,
      }],
      dimensions: usage.dimensions,
    },
  };
}

function positionEntry(index, reference, departments, positions) {
  const number = index + 1;
  const theme = leaderThemes[index];
  const workItemId = deterministicUuid(200 + number * 10);
  const secondaryWorkItemId = deterministicUuid(201 + number * 10);
  const profile = {
    name: `预览负责人 ${String(number).padStart(2, '0')}`,
    departmentId: departments[index].id,
    positionId: positions[index].id,
    currentPositionExperience: '5_10',
  };
  return {
    email: `${SEED_PREFIX}leader-${String(number).padStart(2, '0')}@example.com`,
    kind: 'position',
    profile,
    payload: {
      batchId: reference.activeBatch.id,
      surveyVersionId: reference.activeBatch.positionSurveyVersionId,
      researcherName: profile.name,
      departmentId: profile.departmentId,
      positionId: profile.positionId,
      positionName: positions[index].label,
      relatedPositionExperience: profile.currentPositionExperience,
      workItems: [
        { id: workItemId, name: theme.work, description: theme.process, selectedForImprovement: true },
        { id: secondaryWorkItemId, name: theme.secondaryWork, description: theme.problem, selectedForImprovement: false },
      ],
      taskDemands: [{
        id: deterministicUuid(300 + number),
        workItemId,
        task: theme.task,
        commonInput: theme.input,
        hasFixedInput: true,
        output: theme.output,
        hasFixedOutput: true,
        currentProcess: theme.process,
        mainProblem: theme.problem,
        occurrence: 'weekly',
        stability: 'partly_fixed',
        audience: index === 1 ? 'cross_function' : 'same_position',
        aiParticipation: 'assist',
        expectedAiSupport: theme.support,
        resultUsage: 'human_review',
        humanReviewContent: '核对事实出处、业务约束、遗漏项和最终结论',
        requiresCollaboration: index === 1,
        collaborationDepartments: index === 1 ? [departments[0].label, departments[2].label] : [],
        collaborationPositions: index === 1 ? [positions[0].label, positions[2].label] : [],
        handoffContent: index === 1 ? '接口变化、影响范围、未决项和责任人' : undefined,
        collaborationProblem: index === 1 ? '信息分散且状态更新不同步' : undefined,
        collaborationAiSupport: index === 1 ? '形成带来源的交接草稿并标记待人工确认项' : undefined,
      }],
    },
  };
}

export function buildPreviewSeed(reference) {
  if (!reference?.activeBatch?.id || !reference.activeBatch.employeeSurveyVersionId || !reference.activeBatch.positionSurveyVersionId) {
    throw new Error('预览数据需要包含员工和岗位问卷版本的 active batch');
  }
  const departments = requireRows(reference, 'departments', 3);
  const positions = requireRows(reference, 'positions', 3);
  const tools = requireRows(reference, 'aiTools', 2);
  return [
    ...Array.from({ length: 7 }, (_, index) => employeeEntry(index, reference, departments, positions, tools)),
    ...Array.from({ length: 3 }, (_, index) => positionEntry(index, reference, departments, positions)),
  ];
}
