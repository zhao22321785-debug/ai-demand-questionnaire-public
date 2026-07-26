import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import { AnalysisState } from '../analysis/AnalysisState';
import { EmployeeAnalysisView } from '../analysis/EmployeeAnalysisView';
import { PositionAnalysisView } from '../analysis/PositionAnalysisView';
import { useAnalysisRecord } from '../analysis/useAnalysisRecord';
import { useDataClient } from '../../lib/data/DataClientProvider';
import { getErrorMessage } from '../../lib/errors';
import type { AnalysisRecord, SubjectType } from '../../types/analysis';
import type { AnalysisStatus, EmployeeResponseRecord, PositionResponseRecord, ReferenceData, SurveyResponseRecord } from '../../types/survey';
import { Shell, Status, experienceLabels, formatDate, optionLabel, responseMeta, statusLabels, useReferenceData, valueLabel } from './shared';

const ADMIN_RETRY_POLL_INTERVAL_MS = 2_000;
const ADMIN_RETRY_MAX_ATTEMPTS = 30;
const ADMIN_RETRY_MAX_CONSECUTIVE_ERRORS = 2;

type RetrySyncStatus = 'syncing' | 'settled' | 'timeout' | 'error';

interface AcceptedRetry {
  baseline: string;
  snapshot: AnalysisRecord;
}

function ResponsesPage({ kind }: { kind: 'employee' | 'position' }) {
  const client = useDataClient(); const reference = useReferenceData(); const [query, setQuery] = useState(''); const [status, setStatus] = useState<AnalysisStatus | ''>(''); const [records, setRecords] = useState<SurveyResponseRecord[] | null>(null); const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setRecords(null);
    setError(false);
    if (reference === undefined) return () => { active = false; };
    if (!reference) {
      setError(true);
      return () => { active = false; };
    }
    const batchId = reference.activeBatch.id;
    const filters = { analysisStatus: status || undefined, batchId };
    const request = kind === 'employee' ? client.listEmployeeResponses(filters) : client.listPositionResponses(filters);
    request
      .then((items) => active && setRecords(items.filter((record) => record.batchId === batchId)))
      .catch(() => active && setError(true));
    return () => { active = false; };
  }, [client, kind, reference, status]);
  const title = kind === 'employee' ? '员工答卷' : '负责人答卷'; const visible = records?.filter((record) => { const term = query.trim().toLocaleLowerCase(); return !term || Object.values(responseMeta(record, reference)).join(' ').toLocaleLowerCase().includes(term); });
  return <Shell title={title} note="只读 · 默认显示当前有效记录"><div className="admin-filter-bar"><input aria-label="按姓名、部门或岗位搜索" onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、部门或岗位" value={query} /><select aria-label="分析状态" onChange={(event) => setStatus(event.target.value as AnalysisStatus | '')} value={status}><option value="">全部分析状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>{error ? <PageState tone="danger" title="答卷暂时无法读取" /> : !visible ? <PageState title="正在读取答卷" /> : !visible.length ? <PageState title="当前筛选条件下没有答卷" description="可调整文本或分析状态筛选。" /> : <ResponseTable kind={kind} records={visible} reference={reference} />}</Shell>;
}
export function EmployeeResponsesPage() { return <ResponsesPage kind="employee" />; }
export function PositionResponsesPage() { return <ResponsesPage kind="position" />; }
function ResponseTable({ kind, records, reference }: { kind: 'employee' | 'position'; records: SurveyResponseRecord[]; reference?: ReferenceData | null }) { return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{kind === 'employee' ? '填写人' : '负责人'}</th><th>部门</th><th>{kind === 'employee' ? '岗位' : '调研岗位'}</th><th>经验</th><th>最近提交</th><th>分析状态</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{records.map((record) => { const meta = responseMeta(record, reference); return <tr key={record.id}><td>{meta.name}</td><td>{meta.department}</td><td>{meta.position}</td><td>{meta.experience}</td><td>{formatDate(record.updatedAt)}</td><td><Status status={record.analysisStatus} /></td><td><Link to={`/admin/${kind}-responses/${record.id}`}>查看详情</Link></td></tr>; })}</tbody></table></div>; }

function DetailPage({ kind }: { kind: 'employee' | 'position' }) {
  const { id } = useParams(); const client = useDataClient(); const reference = useReferenceData(); const [record, setRecord] = useState<EmployeeResponseRecord | PositionResponseRecord | null | undefined>(undefined); const [tab, setTab] = useState<'analysis' | 'raw'>('analysis');
  useEffect(() => { let active = true; if (!id) { setRecord(null); return; } const request = kind === 'employee' ? client.getEmployeeResponse(id) : client.getPositionResponse(id); request.then((item) => { if (active) setRecord(item); }).catch(() => active && setRecord(null)); return () => { active = false; }; }, [client, id, kind]);
  const title = kind === 'employee' ? '员工答卷详情' : '负责人答卷详情'; if (record === undefined) return <Shell title={title}><PageState title="正在读取答卷" /></Shell>; if (!record) return <Shell title={title}><PageState tone="warning" title="没有找到这份答卷" description="它可能不存在，或当前没有访问权限。" /></Shell>;
  const meta = responseMeta(record, reference); const analysisLabel = record.type === 'employee' ? '个人需求分析' : '岗位需求分析'; return <Shell title={title}><div className="admin-detail__meta"><span>{meta.name}</span><span>{meta.department}</span><span>{meta.position}</span><span>{meta.experience}</span><span>答卷版本：{record.revision}</span><span>{formatDate(record.updatedAt)}</span><Status status={record.analysisStatus} /></div><div className="admin-tabs" role="tablist" aria-label="答卷内容"><button aria-selected={tab === 'analysis'} onClick={() => setTab('analysis')} role="tab" type="button">{analysisLabel}</button><button aria-selected={tab === 'raw'} onClick={() => setTab('raw')} role="tab" type="button">原始答卷</button></div><section className="admin-detail__content admin-panel__body">{tab === 'analysis' ? <DetailAnalysis key={record.id} kind={kind} record={record} /> : <RawResponse record={record} reference={reference} />}</section></Shell>;
}
export function EmployeeResponseDetailPage() { return <DetailPage kind="employee" />; }
export function PositionResponseDetailPage() { return <DetailPage kind="position" />; }

function DetailAnalysis({ kind, record }: { kind: 'employee' | 'position'; record: EmployeeResponseRecord | PositionResponseRecord }) {
  const [acceptedRetry, setAcceptedRetry] = useState<AcceptedRetry | null>(null);
  return acceptedRetry
    ? <AcceptedAnalysisSync acceptedRetry={acceptedRetry} kind={kind} record={record} />
    : <AnalysisRecordPanel kind={kind} onAccepted={setAcceptedRetry} record={record} />;
}

function analysisFingerprint(analysis: AnalysisRecord | null): string {
  if (!analysis) return 'missing';
  return [analysis.id, analysis.revision, analysis.status, analysis.updatedAt, analysis.attemptCount].join('|');
}

function subjectTypeFor(kind: 'employee' | 'position'): SubjectType {
  return kind === 'employee' ? 'employee_assessment' : 'position_survey';
}

function AnalysisRecordPanel({ kind, onAccepted, record }: { kind: 'employee' | 'position'; onAccepted: (accepted: AcceptedRetry) => void; record: EmployeeResponseRecord | PositionResponseRecord }) {
  const client = useDataClient();
  const subjectType = subjectTypeFor(kind);
  const { analysis } = useAnalysisRecord(subjectType, record.id);
  const [submitting, setSubmitting] = useState(false);
  const [retryError, setRetryError] = useState('');
  const currentAnalysis = analysis && analysis.revision !== record.revision
    ? { ...analysis, status: 'stale' as const, result: null }
    : analysis;
  const canRetry = analysis?.revision === record.revision && (analysis.status === 'failed' || analysis.status === 'stale');
  const retry = async () => {
    if (!analysis || !canRetry) return;
    const acceptedRetry = { baseline: analysisFingerprint(analysis), snapshot: analysis };
    setSubmitting(true);
    setRetryError('');
    try {
      await client.retryAnalysis({ subjectType, subjectId: record.id, revision: record.revision });
      onAccepted(acceptedRetry);
    } catch (error) {
      setRetryError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };
  return <><SingleResponseAnalysis analysis={currentAnalysis} />{canRetry ? <div className="admin-retry"><p><span>当前分析版本：{analysis.revision}</span>{analysis.errorCode ? <><span aria-hidden="true"> · </span><span>失败代码：{analysis.errorCode}</span></> : null}</p><button className="text-action" disabled={submitting} onClick={() => void retry()} type="button">{submitting ? '正在提交…' : '重新分析'}</button>{retryError ? <p className="admin-retry__error" role="alert">{retryError}</p> : null}</div> : null}</>;
}

function AcceptedAnalysisSync({ acceptedRetry, kind, record }: { acceptedRetry: AcceptedRetry; kind: 'employee' | 'position'; record: EmployeeResponseRecord | PositionResponseRecord }) {
  const client = useDataClient();
  const subjectType = subjectTypeFor(kind);
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(acceptedRetry.snapshot);
  const [syncStatus, setSyncStatus] = useState<RetrySyncStatus>('syncing');

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let attempts = 0;
    let consecutiveErrors = 0;
    let observedChange = false;
    const poll = async () => {
      attempts += 1;
      try {
        const result = await client.getAnalysis(subjectType, record.id);
        if (!active) return;
        setAnalysis(result);
        consecutiveErrors = 0;
        observedChange ||= analysisFingerprint(result) !== acceptedRetry.baseline;
        const terminal = observedChange && result !== null && (result.status === 'complete' || result.status === 'failed');
        if (terminal) {
          setSyncStatus('settled');
          return;
        }
      } catch {
        if (!active) return;
        consecutiveErrors += 1;
        if (consecutiveErrors >= ADMIN_RETRY_MAX_CONSECUTIVE_ERRORS) {
          setSyncStatus('error');
          return;
        }
      }
      if (attempts >= ADMIN_RETRY_MAX_ATTEMPTS) {
        setSyncStatus('timeout');
        return;
      }
      timer = window.setTimeout(() => void poll(), ADMIN_RETRY_POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [acceptedRetry, client, record.id, subjectType]);

  const currentAnalysis = analysis && analysis.revision !== record.revision
    ? { ...analysis, status: 'stale' as const, result: null }
    : analysis;
  return <><RetrySyncNotice status={syncStatus} /><SingleResponseAnalysis analysis={currentAnalysis} /></>;
}

function RetrySyncNotice({ status }: { status: RetrySyncStatus }) {
  if (status === 'timeout') return <PageState tone="warning" title="重新分析已受理，但状态同步超时" description="系统仍可能在后台处理，可刷新页面查看最新状态。" />;
  if (status === 'error') return <PageState tone="warning" title="重新分析已受理，但状态同步失败" description="暂时无法继续读取分析状态，可刷新页面查看最新状态。" />;
  return <PageState tone="success" title="重新分析已受理" description={status === 'syncing' ? '系统已重新排队，正在同步最新分析状态；原始答卷和分析结果仍保持只读。' : '已同步最新分析状态；原始答卷和分析结果仍保持只读。'} />;
}

function SingleResponseAnalysis({ analysis }: { analysis: AnalysisRecord | null | undefined }) {
  if (analysis === undefined) return <PageState title="正在读取需求分析" />;
  if (!analysis || analysis.status === 'queued') return <PageState tone="warning" title="分析准备中" description="系统正在准备分析；原始答卷可继续查看，管理员不能编辑答卷或分析结果。" />;
  if (analysis.status === 'running') return <PageState tone="warning" title="正在分析" description="分析完成后会在此更新；原始答卷可继续查看，管理员不能编辑答卷或分析结果。" />;
  if (analysis.status === 'stale') return <PageState tone="warning" title="分析需要更新" description="当前结论已过期，未作为当前结论展示；原始答卷保持只读。" />;
  if (analysis.status === 'failed') return <PageState tone="danger" title="分析暂未完成" description={`${analysis.errorSummary || '分析服务暂时不可用。'} 原始答卷保持只读。`} />;
  if (!analysis.result) return <AnalysisState analysis={analysis} />;
  return <><AnalysisState analysis={analysis} />{analysis.result.kind === 'employee' ? <EmployeeAnalysisView result={analysis.result} /> : <PositionAnalysisView result={analysis.result} />}</>;
}
function listText(values: string[]): string { return values.join('、') || '未填写'; }
function RawResponse({ record, reference }: { record: EmployeeResponseRecord | PositionResponseRecord; reference?: ReferenceData | null }) { if (record.type === 'employee') { const input = record.input; const tools = input.aiToolIds.filter((id) => id !== 'other').map((id) => optionLabel(reference?.aiTools, id)); if (input.aiToolOther) tools.push(`其他：${input.aiToolOther}`); return <><dl><dt>姓名</dt><dd>{input.profile.name}</dd><dt>部门</dt><dd>{optionLabel(reference?.departments, input.profile.departmentId, input.profile.departmentOther)}</dd><dt>岗位</dt><dd>{optionLabel(reference?.positions, input.profile.positionId, input.profile.positionOther)}</dd><dt>岗位经验</dt><dd>{experienceLabels[input.profile.currentPositionExperience]}</dd><dt>AI 使用状态</dt><dd>{valueLabel(input.aiUseStatus)}</dd><dt>未使用原因</dt><dd>{listText(input.nonUseReasons)}</dd><dt>停止持续使用原因</dt><dd>{listText(input.discontinuationReasons)}</dd><dt>AI 工具</dt><dd>{listText(tools)}</dd><dt>AI 使用场景</dt><dd>{listText(input.aiScenarios)}</dd><dt>工作痛点提示</dt><dd>{listText(input.painPoints)}</dd><dt>是否提交明确需求</dt><dd>{input.hasExplicitDemand ? '是' : '否'}</dd><dt>六维行为回顾</dt><dd>{input.dimensions.map((value, index) => `维度 ${index + 1}：${value ?? '不适用'}`).join('；')}</dd></dl><EmployeeTaskList tasks={input.tasks} /></>; } const input = record.input; return <><dl><dt>负责人</dt><dd>{input.researcherName}</dd><dt>所属部门</dt><dd>{optionLabel(reference?.departments, input.departmentId, input.departmentOther)}</dd><dt>岗位类别</dt><dd>{optionLabel(reference?.positions, input.positionId, input.positionOther)}</dd><dt>调研岗位</dt><dd>{input.positionName}</dd><dt>相关岗位经验</dt><dd>{experienceLabels[input.relatedPositionExperience]}</dd><dt>岗位识别键</dt><dd>{record.positionKey}</dd></dl><section><h3>岗位主要工作</h3>{input.workItems.map((item) => <article className="admin-task" key={item.id}><h3>{item.name}</h3><p>{item.description}</p><p>希望优先改进：{item.selectedForImprovement ? '是' : '否'}</p></article>)}</section><PositionTaskList tasks={input.taskDemands} works={input.workItems} /></>; }
function EmployeeTaskList({ tasks }: { tasks: EmployeeResponseRecord['input']['tasks'] }) { if (!tasks.length) return <PageState title="没有提交明确任务" />; return <section><h3>真实任务</h3>{tasks.map((task) => <article className="admin-task" key={task.id}><h3>{task.title}</h3><dl><dt>当前做法</dt><dd>{task.currentProcess}</dd><dt>主要问题</dt><dd>{task.mainProblem}</dd><dt>发生规律</dt><dd>{valueLabel(task.occurrence)}</dd><dt>步骤稳定程度</dt><dd>{valueLabel(task.stability)}</dd><dt>共同使用人群</dt><dd>{valueLabel(task.audience)}</dd><dt>任务级 AI 状态</dt><dd>{valueLabel(task.aiUseStatus)}</dd><dt>AI 使用追问</dt><dd>{task.aiFollowUp || '不适用'}</dd><dt>期望支持</dt><dd>{task.expectedSupport}</dd></dl></article>)}</section>; }
function PositionTaskList({ tasks, works }: { tasks: PositionResponseRecord['input']['taskDemands']; works: PositionResponseRecord['input']['workItems'] }) { return <section><h3>岗位共性任务</h3>{tasks.map((task) => <article className="admin-task" key={task.id}><h3>{task.task}</h3><dl><dt>关联主要工作</dt><dd>{works.find((work) => work.id === task.workItemId)?.name || '未关联'}</dd><dt>常见输入</dt><dd>{task.hasFixedInput ? task.commonInput || '未填写' : '无固定输入'}</dd><dt>常见输出</dt><dd>{task.hasFixedOutput ? task.output || '未填写' : '无固定输出'}</dd><dt>当前做法</dt><dd>{task.currentProcess}</dd><dt>主要问题</dt><dd>{task.mainProblem}</dd><dt>发生规律</dt><dd>{valueLabel(task.occurrence)}</dd><dt>步骤稳定程度</dt><dd>{valueLabel(task.stability)}</dd><dt>覆盖人群</dt><dd>{valueLabel(task.audience)}</dd><dt>AI 参与方式</dt><dd>{valueLabel(task.aiParticipation)}</dd><dt>期望 AI 支持</dt><dd>{task.expectedAiSupport}</dd><dt>结果使用方式</dt><dd>{valueLabel(task.resultUsage)}</dd><dt>人工确认内容</dt><dd>{task.humanReviewContent || '不适用'}</dd><dt>需要协作</dt><dd>{task.requiresCollaboration ? '是' : '否'}</dd><dt>协作部门</dt><dd>{listText(task.collaborationDepartments)}</dd><dt>协作岗位</dt><dd>{listText(task.collaborationPositions)}</dd><dt>交接内容或条件</dt><dd>{task.handoffContent || '不适用'}</dd><dt>协作问题</dt><dd>{task.collaborationProblem || '不适用'}</dd><dt>期望的协作支持</dt><dd>{task.collaborationAiSupport || '不适用'}</dd></dl></article>)}</section>; }
