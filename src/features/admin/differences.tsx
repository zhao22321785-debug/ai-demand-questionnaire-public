import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import type { AggregateScenario, EvidenceDimensionComparison } from '../../types/analysis';
import { AnalysisStateNotice, SampleWarning, ScenarioSourceLinks, Shell, evidenceDimensionLabels, evidenceStatusLabels, relationLabels, scenarioSourceCount, useDashboard } from './shared';

const evidenceSummaryStatuses = ['both_supported', 'employee_only', 'position_evidence_low', 'insufficient_sample'] as const;

export function DifferencesPage() {
  const { dashboard, error } = useDashboard();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [evidence, setEvidence] = useState('');
  if (error) return <Shell title="证据对比"><PageState tone="danger" title="双方证据暂时无法读取" description="请稍后刷新；原始答卷仍保持只读可追溯。" /></Shell>;
  if (!dashboard) return <Shell title="证据对比"><PageState title="正在读取双方证据" /></Shell>;

  const allScenarios = dashboard.aggregateStatus === 'complete' ? dashboard.scenarios : [];
  const query = search.trim().toLocaleLowerCase('zh-CN');
  const scenarios = allScenarios.filter((scenario) => (!query || `${scenario.title} ${scenario.summary}`.toLocaleLowerCase('zh-CN').includes(query)) && (!evidence || scenario.evidenceStatus === evidence));
  const selectedId = params.get('selected');
  const selected = scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0];
  const sampleInsufficient = dashboard.validAnalysisSourceCount < dashboard.minSampleSize;
  const select = (id: string) => { const next = new URLSearchParams(params); next.set('selected', id); setParams(next); };

  return <Shell title="证据对比" note={`${dashboard.batch.name} · 镜像条只表示来源覆盖`}>
    <p className="admin-page-intro">员工和负责人分别提供了哪些证据，哪些一致、互补或缺失？</p>
    <AnalysisStateNotice dashboard={dashboard} />
    {sampleInsufficient ? <SampleWarning minSampleSize={dashboard.minSampleSize} sourceCount={dashboard.validAnalysisSourceCount} /> : null}
    <EvidenceSummary scenarios={allScenarios} />
    <div className="admin-evidence-filters" aria-label="证据对比筛选"><label><span>搜索</span><input aria-label="搜索对比需求" placeholder="搜索具体需求" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label><span>证据状态</span><select aria-label="对比证据状态" value={evidence} onChange={(event) => setEvidence(event.target.value)}><option value="">全部状态</option>{Object.entries(evidenceStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{search || evidence ? <button className="admin-filter-clear" onClick={() => { setSearch(''); setEvidence(''); }} type="button">清除</button> : null}</div>
    {scenarios.length && selected ? <div className="admin-evidence-workbench"><ScenarioRail scenarios={scenarios} selectedId={selected.id} onSelect={select} /><EvidenceDetail scenario={selected} sampleSufficient={dashboard.sampleSufficient} /></div> : <section className="admin-panel"><div className="admin-panel__body"><PageState title="当前没有可比较的需求证据" description="聚合分析完成且版本有效后再展示；未提及不会被写成冲突。" action={<div className="admin-source-actions"><Link to="/admin/employee-responses">员工答卷</Link><Link to="/admin/position-responses">负责人答卷</Link></div>} /></div></section>}
  </Shell>;
}

function EvidenceSummary({ scenarios }: { scenarios: AggregateScenario[] }) {
  const explicitConflictCount = scenarios.filter((scenario) => scenario.evidenceStatus === 'explicit_conflict').length;
  return <section className="admin-evidence-metrics" aria-label="批次证据状态">{evidenceSummaryStatuses.map((status) => <article key={status}><span className={`admin-evidence-dot admin-evidence-dot--${status}`} /><div><span>{evidenceStatusLabels[status]}</span><strong>{scenarios.filter((scenario) => scenario.evidenceStatus === status).length}</strong></div><small>{status === 'both_supported' ? '两侧均有有效来源' : status === 'employee_only' ? '负责人侧当前未提及' : status === 'position_evidence_low' ? '员工侧当前未提及' : '暂不形成共性结论'}</small></article>)}{explicitConflictCount ? <article><span className="admin-evidence-dot admin-evidence-dot--explicit_conflict" /><div><span>明确表达不同</span><strong>{explicitConflictCount}</strong></div><small>仅统计双方对同一事项的明确不同表达</small></article> : null}</section>;
}

function ScenarioRail({ scenarios, selectedId, onSelect }: { scenarios: AggregateScenario[]; selectedId: string; onSelect: (id: string) => void }) {
  return <aside className="admin-panel admin-evidence-rail"><div className="admin-panel__header"><h2>选择具体需求</h2><span className="admin-muted">{scenarios.length} 项</span></div><div className="admin-panel__body"><ul>{scenarios.map((scenario) => {
    const evidenceStale = currentEvidenceDimensions(scenario).unavailableCount > 0;
    return <li key={scenario.id}><button aria-current={scenario.id === selectedId ? 'true' : undefined} className={scenario.id === selectedId ? 'is-selected' : ''} onClick={() => onSelect(scenario.id)} type="button"><strong>{scenario.title}</strong><span>{scenarioSourceCount(scenario, 'employee_assessment')} 份员工来源 · {scenarioSourceCount(scenario, 'position_survey')} 份负责人来源</span><em>{evidenceStale ? '证据待重算' : evidenceStatusLabels[scenario.evidenceStatus]}</em></button></li>;
  })}</ul></div></aside>;
}

function currentEvidenceDimensions(scenario: AggregateScenario): { dimensions: EvidenceDimensionComparison[]; unavailableCount: number } {
  const employeeSources = new Set(scenario.sources.filter((source) => source.subjectType === 'employee_assessment').map((source) => source.subjectId));
  const positionSources = new Set(scenario.sources.filter((source) => source.subjectType === 'position_survey').map((source) => source.subjectId));
  const unavailable = new Set<string>();
  const dimensions = (scenario.evidenceDimensions ?? []).map((item) => {
    const employeeSourceIds = item.employeeSourceIds.filter((sourceId) => {
      const available = employeeSources.has(sourceId);
      if (!available) unavailable.add(`employee:${sourceId}`);
      return available;
    });
    const positionSourceIds = item.positionSourceIds.filter((sourceId) => {
      const available = positionSources.has(sourceId);
      if (!available) unavailable.add(`position:${sourceId}`);
      return available;
    });
    const employeeMissing = employeeSourceIds.length !== item.employeeSourceIds.length;
    const positionMissing = positionSourceIds.length !== item.positionSourceIds.length;
    return {
      ...item,
      employeeSourceIds,
      positionSourceIds,
      employeeSourceCount: employeeSourceIds.length,
      employeeSourceTotal: employeeSources.size,
      positionSourceCount: positionSourceIds.length,
      positionSourceTotal: positionSources.size,
      relation: employeeMissing || positionMissing ? 'insufficient_sample' as const : item.relation,
      employeeSummary: employeeMissing ? '部分引用来源已更新，原员工侧摘要不再作为当前结论展示。' : item.employeeSummary,
      positionSummary: positionMissing ? '部分引用来源已更新，原负责人侧摘要不再作为当前结论展示。' : item.positionSummary,
    };
  });
  return { dimensions, unavailableCount: unavailable.size };
}

function EvidenceDetail({ scenario, sampleSufficient }: { scenario: AggregateScenario; sampleSufficient: boolean }) {
  const currentEvidence = currentEvidenceDimensions(scenario);
  const dimensions = currentEvidence.dimensions.map((item) => sampleSufficient ? item : { ...item, relation: 'insufficient_sample' as const });
  const unavailableCount = currentEvidence.unavailableCount;
  const evidenceLabel = unavailableCount ? '证据待重算' : evidenceStatusLabels[scenario.evidenceStatus];
  const evidenceTone = unavailableCount ? 'insufficient_sample' : scenario.evidenceStatus;
  return <section className="admin-evidence-detail"><header className="admin-evidence-detail__header"><div><span className={`admin-evidence-pill admin-evidence-pill--${evidenceTone}`}>{evidenceLabel}</span><h2>{scenario.title}</h2><p>{unavailableCount ? '部分来源已更新，原聚合摘要已隐藏，等待重新分析。' : scenario.summary}</p></div><div><Link to={`/admin/demands?selected=${encodeURIComponent(scenario.id)}`}>进入需求分析 →</Link><span>员工 {scenarioSourceCount(scenario, 'employee_assessment')} 份 · 负责人 {scenarioSourceCount(scenario, 'position_survey')} 份</span></div></header>
    {unavailableCount ? <PageState tone="warning" title="部分来源当前不可用" description={`${unavailableCount} 个来源已更新或无法读取；对应引用、摘要和关系不会继续作为当前证据展示。`} /> : null}
    <EvidenceReadiness scenario={scenario} dimensions={dimensions} sampleSufficient={sampleSufficient} unavailableCount={unavailableCount} />
    {dimensions.length ? <><MirrorCoverage items={dimensions} /><EvidenceMatrix scenario={scenario} items={dimensions} /></> : <PageState tone="warning" title="结构化证据正在补充" description="当前仍可查看已有来源答卷，但不会依据引用数量推测五个维度的覆盖关系。" action={<ScenarioSourceLinks scenario={scenario} />} />}
  </section>;
}

function EvidenceReadiness({ scenario, dimensions, sampleSufficient, unavailableCount }: { scenario: AggregateScenario; dimensions: EvidenceDimensionComparison[]; sampleSufficient: boolean; unavailableCount: number }) {
  const ordered = Object.keys(evidenceDimensionLabels) as EvidenceDimensionComparison['dimension'][];
  const missing = ordered.filter((dimension) => !dimensions.some((item) => item.dimension === dimension));
  const employeeSources = new Set(scenario.sources.filter((source) => source.subjectType === 'employee_assessment').map((source) => source.subjectId)).size;
  const positionSources = new Set(scenario.sources.filter((source) => source.subjectType === 'position_survey').map((source) => source.subjectId)).size;
  const reason = !sampleSufficient ? '有效来源未达到样本阈值' : unavailableCount ? '部分引用来源已更新或不可用' : missing.length ? '结构化比较尚未完整生成' : employeeSources === 0 || positionSources === 0 ? '当前只有单侧来源' : '无，当前使用完整比较';
  const next = !sampleSufficient ? '补充有效来源后重新分析' : missing.length || unavailableCount ? '先核对原始答卷，等待重新分析' : employeeSources === 0 || positionSources === 0 ? '补充另一侧答卷，未提及不视为冲突' : '展开逐维来源或进入需求分析';
  return <section className="admin-evidence-readiness" aria-label="证据比较完整度"><article><span>降级原因</span><strong>{reason}</strong></article><article><span>已有来源</span><strong>员工 {employeeSources} 份 · 负责人 {positionSources} 份</strong></article><article><span>缺失维度</span><strong>{missing.length ? missing.map((item) => evidenceDimensionLabels[item]).join('、') : '无'}</strong></article><article><span>下一步</span><strong>{next}</strong></article></section>;
}

function MirrorCoverage({ items }: { items: EvidenceDimensionComparison[] }) {
  return <section className="admin-mirror-panel" aria-label="五维证据覆盖镜像图"><header><span>员工来源覆盖</span><strong>比较维度与关系</strong><span>负责人来源覆盖</span></header><div>{items.map((item) => <article key={item.dimension}><div className="admin-mirror-side admin-mirror-side--employee"><span><b>{item.employeeSourceCount}/{item.employeeSourceTotal}</b><small>来源</small></span><i><span style={{ width: `${coveragePercent(item.employeeSourceCount, item.employeeSourceTotal)}%` }} /></i></div><div className="admin-mirror-center"><strong>{evidenceDimensionLabels[item.dimension]}</strong><span className={`admin-relation-pill admin-relation-pill--${item.relation}`}>{relationLabels[item.relation]}</span></div><div className="admin-mirror-side admin-mirror-side--position"><i><span style={{ width: `${coveragePercent(item.positionSourceCount, item.positionSourceTotal)}%` }} /></i><span><b>{item.positionSourceCount}/{item.positionSourceTotal}</b><small>来源</small></span></div></article>)}</div><p className="admin-chart-note">镜像条只表达“覆盖该维度的来源数/该侧有效来源总数”；0/n 是有样本但未提及，0/0 是该侧无有效样本。</p></section>;
}

function EvidenceMatrix({ scenario, items }: { scenario: AggregateScenario; items: EvidenceDimensionComparison[] }) {
  return <section className="admin-evidence-matrix"><div className="admin-evidence-matrix__head"><span>比较维度</span><span>员工侧具体内容</span><span>对比结果</span><span>负责人侧具体内容</span></div>{items.map((item) => <article key={item.dimension}><header><strong>{evidenceDimensionLabels[item.dimension]}</strong><small>{dimensionPrompt(item.dimension)}</small></header><EvidenceSummaryCell tone="employee" summary={item.employeeSummary} count={item.employeeSourceCount} total={item.employeeSourceTotal} /><div className="admin-evidence-matrix__relation"><span className={`admin-relation-pill admin-relation-pill--${item.relation}`}>{relationLabels[item.relation]}</span><small>{relationDescription(item.relation)}</small></div><EvidenceSummaryCell tone="position" summary={item.positionSummary} count={item.positionSourceCount} total={item.positionSourceTotal} /><details><summary>查看本维度来源答卷</summary><div><section><h4>员工来源</h4><ScenarioSourceLinks scenario={scenario} sourceIds={item.employeeSourceIds} /></section><section><h4>负责人来源</h4><ScenarioSourceLinks scenario={scenario} sourceIds={item.positionSourceIds} /></section></div></details></article>)}</section>;
}

function EvidenceSummaryCell({ tone, summary, count, total }: { tone: 'employee' | 'position'; summary: string; count: number; total: number }) {
  const fallback = total === 0 ? '该侧暂无有效样本。' : '该侧当前未提及，不视为观点冲突。';
  return <div className={`admin-evidence-copy admin-evidence-copy--${tone}`}><p>{summary || fallback}</p><span>{count}/{total} 份来源覆盖</span></div>;
}

function coveragePercent(count: number, total: number) { return total > 0 ? Math.max(0, Math.min(100, Math.round(count / total * 100))) : 0; }
function dimensionPrompt(dimension: EvidenceDimensionComparison['dimension']) { return ({ task_context: '在什么任务中发生？', main_problem: '现在的主要问题是什么？', expected_support: '希望 AI 如何支持？', human_boundary: '哪些内容需要人工确认？', system_data_conditions: '需要哪些系统或数据条件？' })[dimension]; }
function relationDescription(relation: EvidenceDimensionComparison['relation']) {
  if (relation === 'explicit_conflict') return '双方对同一事项有明确不同表达。';
  if (relation === 'employee_missing' || relation === 'position_missing' || relation === 'both_missing') return '未提及表示证据缺失，不表示意见冲突。';
  if (relation === 'insufficient_sample') return '保留来源入口，不形成共性判断。';
  return '基于当前有效来源的内容关系归纳。';
}
