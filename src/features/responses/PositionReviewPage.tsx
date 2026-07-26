import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import { SurveyLayout } from '../../components/layout/SurveyLayout';
import { AnalysisState } from '../analysis/AnalysisState';
import { PositionAnalysisView } from '../analysis/PositionAnalysisView';
import { useAnalysisRecord } from '../analysis/useAnalysisRecord';
import { useDataClient } from '../../lib/data';
import type { PositionResponseRecord, PositionTaskDemandInput } from '../../types/survey';

export function PositionReviewPage() {
  const { id } = useParams();
  const client = useDataClient();
  const [record, setRecord] = useState<PositionResponseRecord | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const { analysis, error: analysisError } = useAnalysisRecord('position_survey', id);
  useEffect(() => { let active = true; if (!id) { setRecord(null); return () => { active = false; }; } client.getPositionResponse(id).then((value) => { if (active) setRecord(value); }).catch(() => { if (active) { setError('暂时无法读取答卷，请稍后重试。'); setRecord(null); } }); return () => { active = false; }; }, [client, id]);
  if (record === undefined) return <SurveyLayout module="岗位需求复盘"><PageState title="正在读取答卷" /></SurveyLayout>;
  if (!record) return <SurveyLayout module="岗位需求复盘"><PageState tone="danger" title={error || '未找到这份岗位答卷'} action={<Link to="/survey/position">返回岗位问卷</Link>} /></SurveyLayout>;
  const { input } = record;
  const currentAnalysis = analysis?.status === 'complete' && analysis.revision !== record.revision ? { ...analysis, status: 'stale' as const } : analysis;
  const result = currentAnalysis?.status === 'complete' && currentAnalysis.revision === record.revision && currentAnalysis.result?.kind === 'position' ? currentAnalysis.result : null;
  return <SurveyLayout module="岗位需求复盘" progress={`第 ${record.revision} 版`}><section className="position-review" aria-labelledby="position-review-title"><p className="eyebrow">岗位需求复盘</p><h1 id="position-review-title">{input.positionName}</h1><p>负责人：{input.researcherName} · 保存于 {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.updatedAt))}</p>{analysisError ? <PageState tone="danger" title="暂时无法读取分析状态" description={analysisError} /> : <AnalysisState analysis={currentAnalysis ?? null} />}{result ? <PositionAnalysisView result={result} onOpenEvidence={() => setShowRaw(true)} /> : null}<div className="employee-review__actions"><button className="employee-review__text-button" type="button" onClick={() => setShowRaw((value) => !value)}>{showRaw ? '收起原始回答' : '查看原始回答'}</button><Link to={`/survey/position?edit=${encodeURIComponent(record.id)}`}>修改答卷</Link></div>{!result || showRaw ? <><section aria-labelledby="work-title"><h2 id="work-title">希望改进的主要工作</h2><ul>{input.workItems.filter((item) => item.selectedForImprovement).map((item) => <li key={item.id}><strong>{item.name}</strong>{item.description ? <span>：{item.description}</span> : null}</li>)}</ul></section><section id="raw-answers" aria-labelledby="answer-title"><h2 id="answer-title">原始回答</h2>{input.taskDemands.map((task, index) => <TaskAnswer key={task.id ?? `${task.task}-${index}`} task={task} workName={input.workItems.find((item) => item.id === task.workItemId)?.name} />)}</section></> : null}<p className="quiet-link">本页不生成岗位总分、排序或未经验证的 Agent 结论。</p></section></SurveyLayout>;
}

function TaskAnswer({ task, workName }: { task: PositionTaskDemandInput; workName?: string }) {
  const input = task.hasFixedInput ? task.commonInput || '暂未填写' : '无固定输入';
  const output = task.hasFixedOutput ? task.output || '暂未填写' : '无固定输出';
  return <article id={task.id ? `raw-task-${encodeURIComponent(task.id)}` : undefined} className="position-review__task"><h3>{task.task || '未命名任务'}</h3><dl><dt>关联主要工作</dt><dd>{workName || '未关联'}</dd><dt>输入 / 输出</dt><dd>{input} / {output}</dd><dt>当前做法</dt><dd>{task.currentProcess || '暂未填写'}</dd><dt>主要问题</dt><dd>{task.mainProblem || '暂未填写'}</dd><dt>发生规律 / 稳定程度</dt><dd>{label(task.occurrence)} / {label(task.stability)}</dd><dt>覆盖人群</dt><dd>{label(task.audience)}</dd><dt>AI 参与方式</dt><dd>{label(task.aiParticipation)}</dd><dt>具体支持</dt><dd>{task.expectedAiSupport || '暂未填写'}</dd><dt>结果使用方式</dt><dd>{label(task.resultUsage)}{task.humanReviewContent ? `；人工确认：${task.humanReviewContent}` : ''}</dd>{task.requiresCollaboration ? <><dt>协作条件</dt><dd>{[task.collaborationDepartments.join('、'), task.collaborationPositions.join('、'), task.handoffContent, task.collaborationProblem, task.collaborationAiSupport].filter(Boolean).join('；') || '已标记需要协作，暂未补充条件'}</dd></> : null}</dl></article>;
}
function label(value: string): string { return ({ daily: '几乎每天发生', weekly: '每周会发生', monthly_stage: '按月或阶段性发生', project_event: '随项目或事件发生', irregular: '没有固定规律', unknown: '暂不确定', fixed: '步骤基本固定', partly_fixed: '部分步骤固定', variable: '每次情况不同', single: '少数固定人员', same_position: '同岗位多数人员', cross_function: '跨岗位协作人员', reference: '提供参考', assist: '辅助完成部分工作', partial_automation: '自动完成部分固定步骤', mostly_automated: '承担大部分重复工作', direct: '可直接用于后续工作', human_review: '需要人工审核后使用', reference_only: '仅作为参考' } as Record<string, string>)[value] ?? '暂不确定'; }
