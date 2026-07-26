import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import { SurveyLayout } from '../../components/layout/SurveyLayout';
import { AnalysisState } from '../analysis/AnalysisState';
import { EmployeeAnalysisView } from '../analysis/EmployeeAnalysisView';
import { useAnalysisRecord } from '../analysis/useAnalysisRecord';
import { useDataClient } from '../../lib/data';
import type { EmployeeResponseRecord, ReferenceData } from '../../types/survey';
import '../employee-survey/employee-survey.css';

const aiStatusLabels = { frequent: '经常使用 AI', sometimes: '有时使用 AI', tried_rarely: '尝试过，但很少使用 AI', never: '还没有使用过 AI' };
const occurrenceLabels = { daily: '几乎每天', weekly: '每周都会', monthly_stage: '每月或阶段性', project_event: '按项目或特定事件', irregular: '没有固定规律', unknown: '未说明' };
const stabilityLabels = { fixed: '基本固定', partly_fixed: '部分固定', variable: '变化较大', unknown: '未说明' };
const audienceLabels = { self: '主要是我自己', same_position: '同岗位还有其他人', cross_function: '涉及多个岗位或部门', unknown: '未说明' };

export function EmployeeReviewPage() {
  const client = useDataClient();
  const { id } = useParams();
  const [record, setRecord] = useState<EmployeeResponseRecord | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const { analysis, error: analysisError } = useAnalysisRecord('employee_assessment', id);

  useEffect(() => {
    if (!id) { setRecord(null); return; }
    let active = true;
    void client.getEmployeeResponse(id).then((result) => { if (active) setRecord(result); }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [client, id]);
  useEffect(() => { let active = true; void client.getReferenceData().then((value) => { if (active) setReference(value); }).catch(() => undefined); return () => { active = false; }; }, [client]);

  if (loadError) return <SurveyLayout module="个人复盘"><PageState title="暂时无法读取答卷" description="请稍后重试；这不会影响已保存的答卷。" tone="danger" /></SurveyLayout>;
  if (record === undefined) return <SurveyLayout module="个人复盘"><PageState title="正在读取答卷" description="请稍候。" /></SurveyLayout>;
  if (!record) return <SurveyLayout module="个人复盘"><PageState title="没有找到这份答卷" description="它可能不存在，或当前账号没有查看权限。" tone="warning" action={<Link to="/survey/responses">返回我的答卷</Link>} /></SurveyLayout>;

  const { input } = record;
  const hasTasks = input.hasExplicitDemand && input.tasks.length > 0;
  const position = input.profile.positionOther || reference?.positions.find((item) => item.id === input.profile.positionId)?.label || input.profile.positionId || '未说明岗位';
  const department = input.profile.departmentOther || reference?.departments.find((item) => item.id === input.profile.departmentId)?.label || input.profile.departmentId || '未说明部门';
  const currentAnalysis = analysis?.status === 'complete' && analysis.revision !== record.revision ? { ...analysis, status: 'stale' as const } : analysis;
  const result = currentAnalysis?.status === 'complete' && currentAnalysis.revision === record.revision && currentAnalysis.result?.kind === 'employee' ? currentAnalysis.result : null;
  return <SurveyLayout module="个人复盘" progress={`第 ${record.revision} 版`}><main className="employee-review">
    <header className="employee-review__header"><p className="eyebrow">个人需求复盘</p><h1>{hasTasks ? '已记录您想改善的真实工作' : '本次没有提交明确想改善的工作'}</h1><p>{input.profile.name} · {department} · {position} · 提交于 {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.updatedAt))}</p></header>
    {analysisError ? <PageState title="暂时无法读取分析状态" description={analysisError} tone="danger" /> : <AnalysisState analysis={currentAnalysis ?? null} />}
    {result ? <EmployeeAnalysisView result={result} onOpenEvidence={() => setShowRaw(true)} /> : null}
    {!result ? <>{hasTasks ? <section className="employee-review__section" aria-labelledby="tasks-title"><h2 id="tasks-title">真实任务与需求线索</h2>{input.tasks.map((task, index) => <article className="employee-review__task" key={`${task.title}-${index}`}><p className="eyebrow">{index === 0 ? '最希望改善' : '补充任务'}</p><h3>{task.title}</h3><p><strong>当前问题：</strong>{task.mainProblem}</p><p><strong>期望支持：</strong>{task.expectedSupport}</p><dl><div><dt>发生规律</dt><dd>{occurrenceLabels[task.occurrence]}</dd></div><div><dt>步骤稳定程度</dt><dd>{stabilityLabels[task.stability]}</dd></div><div><dt>共同使用人群</dt><dd>{audienceLabels[task.audience]}</dd></div></dl></article>)}</section> : null}<section className="employee-review__section" aria-labelledby="usage-title"><h2 id="usage-title">AI 使用背景</h2><p>{aiStatusLabels[input.aiUseStatus]}</p>{input.aiUseStatus === 'never' ? <p className="employee-review__muted">暂未形成 AI 使用行为数据；未适用维度不会被当作低分或缺失答卷。</p> : <><p>使用工具：{input.aiToolIds.length ? input.aiToolIds.join('、') : '未说明'}</p><p>主要场景：{input.aiScenarios.length ? input.aiScenarios.join('、') : '未说明'}</p></>}</section><section className="employee-review__section" aria-labelledby="dimensions-title"><h2 id="dimensions-title">行为回顾</h2>{input.aiUseStatus === 'never' ? <p>仅记录了 AI 认知与场景判断；其余维度不适用。</p> : <p>此处用于回顾实际做法，不展示总分、排名或绩效评价。</p>}<div className="employee-review__dimension-list">{input.dimensions.map((answer, index) => <div key={index}><span>维度 {index + 1}</span><strong>{answer === null ? '不适用' : '已完成回顾'}</strong></div>)}</div></section></> : null}
    <div className="employee-review__actions"><button className="employee-review__text-button" type="button" onClick={() => setShowRaw((value) => !value)}>{showRaw ? '收起原始回答' : '查看原始回答'}</button><Link className="employee-review__edit" to={`/survey/employee?edit=${encodeURIComponent(record.id)}`}>修改答卷</Link></div>
    {showRaw ? <section className="employee-review__section" id="raw-answers" aria-labelledby="raw-title"><h2 id="raw-title">原始回答</h2><dl className="employee-review__raw"><div><dt>工作痛点提示</dt><dd>{input.painPoints.join('、') || '未填写'}</dd></div>{input.tasks.map((task, index) => <div id={task.id ? `raw-task-${encodeURIComponent(task.id)}` : undefined} key={index}><dt>任务 {index + 1}：当前做法</dt><dd>{task.currentProcess}</dd></div>)}</dl></section> : null}
  </main></SurveyLayout>;
}
