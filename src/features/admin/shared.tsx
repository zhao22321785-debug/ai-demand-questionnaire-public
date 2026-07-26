import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import { AdminFrame } from '../../components/layout/AdminFrame';
import { useDataClient } from '../../lib/data/DataClientProvider';
import type { AdminDashboardDto, AggregateScenario } from '../../types/analysis';
import type { AnalysisStatus, ReferenceData, SurveyResponseRecord } from '../../types/survey';

export const statusLabels: Record<AnalysisStatus, string> = {
  pending: '分析准备中', running: '分析中', complete: '分析完成', failed: '分析失败', stale: '分析已过期',
};

export const evidenceStatusLabels = {
  both_supported: '双方均有证据',
  employee_only: '仅员工侧有证据',
  position_evidence_low: '仅负责人侧有证据',
  explicit_conflict: '明确表达不同',
  insufficient_sample: '当前证据较少',
} as const;

export const relationLabels = {
  both_mentioned: '双方均提及',
  complementary: '信息互补',
  direction_aligned: '方向基本一致',
  employee_supplement: '员工侧补充',
  position_supplement: '负责人侧补充',
  employee_missing: '员工侧未提及',
  position_missing: '负责人侧未提及',
  both_missing: '双方均未说明',
  explicit_conflict: '明确表达不同',
  insufficient_sample: '样本不足',
} as const;

export const evidenceDimensionLabels = {
  task_context: '实际工作场景',
  main_problem: '主要问题',
  expected_support: '期望支持方向',
  human_boundary: '人工确认边界',
  system_data_conditions: '系统与数据条件',
} as const;

export const completenessLabels = {
  complete: '信息较完整', partial: '部分信息待补', insufficient: '信息不足',
} as const;

export const experienceLabels = { under_1: '1 年以内', '1_3': '1–3 年', '3_5': '3–5 年', '5_10': '5–10 年', over_10: '10 年以上' } as const;
export const valueLabels: Record<string, string> = { frequent: '经常使用', sometimes: '有时使用', tried_rarely: '尝试过但很少使用', never: '还没有使用过', using: '正在使用', stopped: '尝试过但现在没有使用', daily: '几乎每天', weekly: '每周', monthly_stage: '每月或阶段性', project_event: '按项目或事件', irregular: '没有固定规律', unknown: '暂不确定', fixed: '基本固定', partly_fixed: '部分固定', variable: '变化较大', self: '主要是本人', single: '少数固定人员', same_position: '同岗位多人', cross_function: '多个岗位或部门', reference: '提供参考', assist: '协助完成', partial_automation: '自动处理部分步骤', mostly_automated: '自动完成大部分工作', direct: '可以直接使用', human_review: '人工确认后使用', reference_only: '仅作参考' };

export const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
export const valueLabel = (value: string) => valueLabels[value] ?? value;
export function scenarioSourceCount(scenario: AggregateScenario, subjectType?: AggregateScenario['sources'][number]['subjectType']): number {
  return new Set(scenario.sources
    .filter((source) => !subjectType || source.subjectType === subjectType)
    .map((source) => `${source.subjectType}:${source.subjectId}`)).size;
}

export function Shell({ children, title, note, kicker = '当前调研批次' }: { children: ReactNode; title: string; note?: string; kicker?: string }) {
  return <AdminFrame><div className="admin-page"><header className="admin-page-header admin-page-header--split"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1></div>{note ? <p className="admin-page-header__note">{note}</p> : null}</header>{children}</div></AdminFrame>;
}

export function ViewTabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return <div className="admin-view-tabs" role="tablist" aria-label={label}>{options.map(([id, text]) => <button aria-selected={id === value} key={id} onClick={() => onChange(id)} role="tab" type="button">{text}</button>)}</div>;
}

export function AnalysisStateNotice({ dashboard }: { dashboard: AdminDashboardDto }) {
  if (dashboard.aggregateStatus === 'failed') return <PageState tone="danger" title="聚合分析暂时失败" description={dashboard.errorSummary || '原始答卷和固定统计仍可查看；失败的 Agent 结论不会作为当前结论展示。'} />;
  if (dashboard.aggregateStatus === 'stale') return <PageState tone="warning" title="分析已过期，正在重新计算" description="答卷已更新，旧版 Agent 结论未作为当前结论展示；固定统计和原始答卷仍可查看。" />;
  if (dashboard.aggregateStatus === 'running') return <PageState title="聚合分析进行中" description="固定统计已可查看，结构化证据和初步结论将在完成后出现。" />;
  if (dashboard.aggregateStatus === 'pending') return <PageState title="聚合分析正在准备" description="已收到答卷，正在等待本批次分析。" />;
  return null;
}

export function Status({ status }: { status: AnalysisStatus }) { return <span className={`admin-status admin-status--${status}`}>{statusLabels[status]}</span>; }

export function SampleWarning({ minSampleSize, sourceCount }: { minSampleSize: number; sourceCount?: number }) {
  return <PageState tone="warning" title="样本不足，暂不形成共性结论" description={`当前${sourceCount === undefined ? '' : `有 ${sourceCount} 份可用来源，`}需要至少 ${minSampleSize} 份有效样本后才展示岗位共性、部门比较或趋势。来源答卷仍可查看。`} />;
}

export function optionLabel(options: ReferenceData['departments'] | ReferenceData['positions'] | ReferenceData['aiTools'] | undefined, id?: string, other?: string): string { return other || options?.find((item) => item.id === id)?.label || id || '未填写'; }
export function responseMeta(record: SurveyResponseRecord, reference?: ReferenceData | null) { return record.type === 'employee' ? { name: record.input.profile.name, department: optionLabel(reference?.departments, record.input.profile.departmentId, record.input.profile.departmentOther), position: optionLabel(reference?.positions, record.input.profile.positionId, record.input.profile.positionOther), experience: experienceLabels[record.input.profile.currentPositionExperience] } : { name: record.input.researcherName, department: optionLabel(reference?.departments, record.input.departmentId, record.input.departmentOther), position: record.input.positionName, experience: experienceLabels[record.input.relatedPositionExperience] }; }
export function useReferenceData() { const client = useDataClient(); const [reference, setReference] = useState<ReferenceData | null | undefined>(undefined); useEffect(() => { let active = true; client.getReferenceData().then((value) => active && setReference(value)).catch(() => active && setReference(null)); return () => { active = false; }; }, [client]); return reference; }
export function useRecords(kind: 'employee' | 'position') { const client = useDataClient(); const [records, setRecords] = useState<SurveyResponseRecord[] | null>(null); const [error, setError] = useState(false); useEffect(() => { let active = true; setRecords(null); setError(false); const request = kind === 'employee' ? client.listEmployeeResponses() : client.listPositionResponses(); request.then((items) => active && setRecords(items)).catch(() => active && setError(true)); return () => { active = false; }; }, [client, kind]); return { records, error }; }
export function useDashboard() { const client = useDataClient(); const [dashboard, setDashboard] = useState<AdminDashboardDto | null>(null); const [error, setError] = useState(false); useEffect(() => { let active = true; let timer: number | undefined; setDashboard(null); setError(false); const load = () => client.getAdminDashboard().then((value) => { if (!active) return; setDashboard(value); setError(false); if (['pending', 'running', 'stale'].includes(value.aggregateStatus)) timer = window.setTimeout(load, 3_000); }).catch(() => { if (active) setError(true); }); void load(); return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); }; }, [client]); return { dashboard, error }; }

export function ScenarioSourceLinks({ scenario, sourceIds }: { scenario: AggregateScenario; sourceIds?: string[] }) {
  const sourceSet = sourceIds ? new Set(sourceIds) : null;
  const sources = sourceSet ? scenario.sources.filter((source) => sourceSet.has(source.subjectId)) : scenario.sources;
  return sources.length ? <ul className="admin-source-links">{sources.map((source) => <li key={`${source.subjectType}-${source.subjectId}`}><Link to={source.route}><span><strong>{source.title}</strong><small>{source.subjectType === 'employee_assessment' ? '员工答卷' : '负责人答卷'} · 修订 {source.revision}</small></span><b>查看来源 →</b></Link></li>)}</ul> : <p className="admin-muted">来源答卷已更新或当前不可用。该引用不再作为当前证据展示。</p>;
}
