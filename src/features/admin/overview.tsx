import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import { employeeDimensionDefinitions } from '../../lib/survey/employee-dimensions';
import type { AdminDashboardDto, AggregateScenario, DashboardDimensionStat } from '../../types/analysis';
import { AnalysisStateNotice, SampleWarning, Shell, ViewTabs, completenessLabels, evidenceStatusLabels, scenarioSourceCount, useDashboard } from './shared';

type OverviewView = 'focus' | 'distribution' | 'ai';
type DistributionView = 'demand' | 'position';
const evidenceStatuses = ['both_supported', 'employee_only', 'position_evidence_low', 'insufficient_sample'] as const;
const dimensionNames = employeeDimensionDefinitions.map((item) => item.name);
const dimensionShortNames = employeeDimensionDefinitions.map((item) => item.shortName);

function compareScenarioSignals(a: AggregateScenario, b: AggregateScenario): number {
  const sourceDifference = scenarioSourceCount(b) - scenarioSourceCount(a);
  if (sourceDifference) return sourceDifference;
  const positionDifference = b.positions.length - a.positions.length;
  if (positionDifference) return positionDifference;
  const bHasBothSides = scenarioSourceCount(b, 'employee_assessment') > 0 && scenarioSourceCount(b, 'position_survey') > 0 ? 1 : 0;
  const aHasBothSides = scenarioSourceCount(a, 'employee_assessment') > 0 && scenarioSourceCount(a, 'position_survey') > 0 ? 1 : 0;
  return bHasBothSides - aHasBothSides || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id);
}

export function AdminOverviewPage() {
  const { dashboard, error } = useDashboard();
  const [view, setView] = useState<OverviewView>('focus');
  if (error) return <Shell title="数据总览"><PageState tone="danger" title="数据暂时无法读取" description="请稍后刷新页面。" /></Shell>;
  if (!dashboard) return <Shell title="数据总览"><PageState title="正在读取当前批次分析" /></Shell>;

  const scenarios = dashboard.aggregateStatus === 'complete' ? dashboard.scenarios : [];
  const sampleInsufficient = dashboard.validAnalysisSourceCount < dashboard.minSampleSize;
  return <Shell title="数据总览" note={`${dashboard.batch.name} · 只读`}>
    <ViewTabs label="数据总览视图" value={view} onChange={setView} options={[["focus", '重点概览'], ['distribution', '需求分布'], ['ai', 'AI 使用现状']]} />
    <AnalysisStateNotice dashboard={dashboard} />
    {sampleInsufficient ? <SampleWarning minSampleSize={dashboard.minSampleSize} sourceCount={dashboard.validAnalysisSourceCount} /> : null}
    {view === 'focus' ? <FocusOverview dashboard={dashboard} scenarios={scenarios} /> : view === 'distribution' ? <DemandDistribution dashboard={dashboard} scenarios={scenarios} /> : <AiUsage dashboard={dashboard} />}
  </Shell>;
}

function FocusOverview({ dashboard, scenarios }: { dashboard: AdminDashboardDto; scenarios: AggregateScenario[] }) {
  const effectiveResponses = dashboard.metrics.find((metric) => metric.label === '有效答卷')?.value ?? dashboard.validAnalysisSourceCount;
  const metrics = [
    { label: '有效答卷', value: effectiveResponses, note: '当前批次可用来源' },
    { label: '具体需求', value: scenarios.length, note: '由有效答卷聚合' },
    { label: '值得继续了解的线索', value: scenarios.filter((scenario) => scenario.completeness !== 'insufficient').length, note: '不是优先级或立项结论' },
  ];
  const findings = [...scenarios].sort(compareScenarioSignals).slice(0, 3);
  const evidenceCounts = evidenceStatuses.map((status) => ({
    status,
    label: evidenceStatusLabels[status],
    count: scenarios.filter((scenario) => scenario.evidenceStatus === status || (status === 'both_supported' && scenario.evidenceStatus === 'explicit_conflict')).length,
  }));
  const total = Math.max(1, evidenceCounts.reduce((sum, item) => sum + item.count, 0));
  const stops = evidenceCounts.reduce<number[]>((values, item) => [...values, (values.at(-1) ?? 0) + item.count / total * 100], []);
  const donutBackground = `radial-gradient(circle at center, #0a2033 55%, transparent 57%), conic-gradient(#35ddd5 0 ${stops[0]}%, #6689ff ${stops[0]}% ${stops[1]}%, #9b73e6 ${stops[1]}% ${stops[2]}%, #f3aa4d ${stops[2]}% ${stops[3]}%)`;

  return <>
    <div className="admin-metric-grid admin-metric-grid--three">{metrics.map((metric) => <article className="admin-metric" key={metric.label}><span className="admin-metric__label">{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></article>)}</div>
    <div className="admin-focus-grid">
      <section className="admin-panel admin-panel--flush"><div className="admin-panel__header"><h2>重点发现</h2><span className="admin-muted">按有效来源数量展示，最多 3 条</span></div><div className="admin-panel__body">{findings.length ? <ol className="admin-finding-list">{findings.map((scenario, index) => <li key={scenario.id}><span className="admin-finding-list__index">{index + 1}</span><div><div className="admin-card-heading"><strong>{scenario.title}</strong><span className={`admin-evidence-pill admin-evidence-pill--${scenario.evidenceStatus}`}>{evidenceStatusLabels[scenario.evidenceStatus]}</span></div><p>{scenario.summary}</p><dl><div><dt>适用范围</dt><dd>{scenario.departments.join('、') || '部门待补'} · {scenario.positions.join('、') || '岗位待补'}</dd></div><div><dt>有效来源</dt><dd>{scenarioSourceCount(scenario)} 份答卷</dd></div></dl><Link aria-label={`分析 ${scenario.title}`} to={`/admin/demands?selected=${encodeURIComponent(scenario.id)}`}>进入需求分析 →</Link></div></li>)}</ol> : <EmptyAnalysis />}</div></section>
      <section className="admin-panel admin-evidence-summary"><div className="admin-panel__header"><h2>需求证据结构</h2><Link to="/admin/differences">查看证据对比 →</Link></div><div className="admin-panel__body">{scenarios.length ? <><div className="admin-evidence-donut" aria-label="需求证据结构摘要" style={{ background: donutBackground }}><strong>{scenarios.length}</strong><span>条需求线索</span></div><ul aria-label="需求证据结构分类">{evidenceCounts.map((item) => <li key={item.status}><span className={`admin-evidence-dot admin-evidence-dot--${item.status}`} /><span>{item.label}</span><b>{item.count}</b></li>)}</ul><p className="admin-chart-note">颜色只区分证据来源结构，不表示优先级；明确不同在这里计入双方均有证据。</p></> : <EmptyAnalysis />}</div></section>
    </div>
  </>;
}

function DemandDistribution({ dashboard, scenarios }: { dashboard: AdminDashboardDto; scenarios: AggregateScenario[] }) {
  const [mode, setMode] = useState<DistributionView>('demand');
  return <section className="admin-panel admin-panel--flush"><div className="admin-panel__header admin-panel__header--stack"><div><h2>具体需求如何分布</h2><p>从来源构成或岗位样本两个角度查看同一批确定性统计。</p></div><ViewTabs label="需求分布视角" value={mode} onChange={setMode} options={[["demand", '按需求看'], ['position', '按岗位看']]} /></div><div className="admin-panel__body">{mode === 'demand' ? <DemandSourceComposition scenarios={scenarios} /> : <PositionMatrix dashboard={dashboard} />}</div></section>;
}

function DemandSourceComposition({ scenarios }: { scenarios: AggregateScenario[] }) {
  const sorted = [...scenarios].sort(compareScenarioSignals);
  const [selectedId, setSelectedId] = useState(sorted[0]?.id ?? '');
  const selected = sorted.find((scenario) => scenario.id === selectedId) ?? sorted[0];
  if (!selected) return <EmptyAnalysis />;
  return <div className="admin-demand-composition"><ul className="admin-demand-composition__list" aria-label="需求来源构成">{sorted.map((scenario, index) => {
    const employeeCount = scenarioSourceCount(scenario, 'employee_assessment');
    const positionCount = scenarioSourceCount(scenario, 'position_survey');
    const total = Math.max(1, employeeCount + positionCount);
    return <li key={scenario.id}><button aria-label={`${scenario.title}，${evidenceStatusLabels[scenario.evidenceStatus]}`} aria-pressed={scenario.id === selected.id} onClick={() => setSelectedId(scenario.id)} type="button"><span className="admin-demand-composition__title"><strong>{scenario.title}</strong>{index === 0 && sorted.length > 1 ? <em>当前来源最多</em> : scenario.positions.length > 1 ? <em>跨 {scenario.positions.length} 个岗位</em> : null}<small>{scenario.capabilityTheme}</small></span><span className="admin-source-stack" aria-label={`员工来源 ${employeeCount}，负责人来源 ${positionCount}`}><i className="is-employee" style={{ width: `${employeeCount / total * 100}%` }} /><i className="is-position" style={{ width: `${positionCount / total * 100}%` }} /></span><span className="admin-demand-composition__counts"><b>{employeeCount}</b><small>员工</small><b>{positionCount}</b><small>负责人</small></span><span className={`admin-evidence-pill admin-evidence-pill--${scenario.evidenceStatus}`}>{evidenceStatusLabels[scenario.evidenceStatus]}</span></button></li>;
  })}</ul><article className="admin-demand-selected"><div><span className="admin-capability-tag">{selected.capabilityTheme}</span><span className={`admin-evidence-pill admin-evidence-pill--${selected.evidenceStatus}`}>{evidenceStatusLabels[selected.evidenceStatus]}</span></div><h3>{selected.title}</h3><p>{selected.summary}</p><dl><div><dt>来源构成</dt><dd>{scenarioSourceCount(selected, 'employee_assessment')} 份员工来源 · {scenarioSourceCount(selected, 'position_survey')} 份负责人来源</dd></div><div><dt>涉及岗位</dt><dd>{selected.positions.join('、') || '待补充'}</dd></div><div><dt>信息完整度</dt><dd>{completenessLabels[selected.completeness]}</dd></div></dl><div className="admin-demand-selected__actions"><Link to={`/admin/demands?selected=${encodeURIComponent(selected.id)}`}>查看初步分析 →</Link><Link to={`/admin/differences?selected=${encodeURIComponent(selected.id)}`}>查看证据对比 →</Link></div></article></div>;
}

function PositionMatrix({ dashboard }: { dashboard: AdminDashboardDto }) {
  const matrix = dashboard.positionDemandMatrix;
  if (!matrix.positions.length || !matrix.scenarios.length) return <PageState title="暂无岗位矩阵" description="当前没有可用岗位样本；“—”只用于无样本，不会与 0/n 混淆。" />;
  return <><div className="admin-matrix-legend"><span><i className="is-low" />岗位内提及比例较低</span><span><i className="is-high" />岗位内提及比例较高</span><span>颜色不表示优先级</span></div><div className="admin-matrix-scroll"><div className="admin-position-matrix" role="table" aria-label="岗位需求提及矩阵"><div className="admin-position-matrix__head" role="row"><span role="columnheader">岗位 / 有效样本</span>{matrix.scenarios.map((scenario) => <span key={scenario.scenarioId} role="columnheader"><b>{scenario.title}</b><small>{scenario.capabilityTheme}</small></span>)}</div>{matrix.positions.map((position) => <div className="admin-position-matrix__row" role="row" key={position.position}><span role="rowheader"><b>{position.position}</b><small>{position.validSampleCount} 份有效样本</small></span>{matrix.scenarios.map((scenario) => { const cell = matrix.cells.find((item) => item.position === position.position && item.scenarioId === scenario.scenarioId); const denominator = cell?.validSampleCount ?? position.validSampleCount; const mentions = cell?.mentions ?? 0; const ratio = denominator > 0 ? mentions / denominator : 0; return <span className={denominator === 0 ? 'is-empty' : ratio >= .67 ? 'is-high' : ratio > 0 ? 'is-mid' : 'is-zero'} key={scenario.scenarioId} role="cell"><b>{denominator === 0 ? '—' : `${mentions}/${denominator}`}</b><small>{denominator === 0 ? '无样本' : mentions === 0 ? '有样本，未提及' : '岗位内提及'}</small></span>; })}</div>)}</div></div><p className="admin-chart-note">单元格为“提及人数/该岗位有效样本数”。小样本只展示事实，不形成岗位共性或趋势结论。</p></>;
}

function AiUsage({ dashboard }: { dashboard: AdminDashboardDto }) {
  const stats = dashboard.aiUsageStats;
  const denominator = stats.validSampleCount;
  const dimensions = employeeDimensionDefinitions.map((definition) => ({
    average: dashboard.dimensions.find((item) => item.dimensionKey === definition.key)?.average ?? null,
    validSampleCount: dashboard.dimensions.find((item) => item.dimensionKey === definition.key)?.validSampleCount ?? 0,
    dimensionKey: definition.key,
    dimension: definition.name,
    description: definition.description,
  }));
  return <div className="admin-ai-usage"><section className="admin-panel admin-panel--flush admin-ai-status"><div className="admin-panel__header"><div><h2>AI 使用情况</h2><p>所有比例均以员工有效答卷为分母。</p></div><span className="admin-sample-count">总体样本 {denominator} 份</span></div><div className="admin-panel__body"><StatusComposition items={stats.statuses} total={denominator} /><div className="admin-ai-top-grid"><TopList title="常见使用场景（前 5 项）" items={stats.scenarios} total={denominator} /><TopList title="主要使用障碍（前 5 项）" items={stats.barriers} total={denominator} /><CompactFacts title="常见工具" items={stats.tools} total={denominator} /><CompactFacts title="未使用原因" items={stats.nonUseReasons} total={denominator} /></div></div></section><section className="admin-panel admin-panel--flush admin-profile-panel"><div className="admin-panel__header"><div><h2>员工画像</h2><p>六维分别观察，不计算总分或排名。</p></div><span className="admin-muted">固定顺序 · 无总分 · 无排名</span></div><div className="admin-panel__body"><div className="admin-profile-layout"><RadarChart dimensions={dimensions} /><div className="admin-profile-list">{dimensions.map((item, index) => <article key={item.dimension}><span>{index + 1}</span><div><strong>{item.dimension}</strong><p>{item.description}</p><small>{item.validSampleCount ?? 0} 份有效样本</small></div>{item.average == null ? <b>—</b> : <b>{item.average.toFixed(1)}<small>/5</small></b>}</article>)}</div></div><p className="admin-chart-note">未使用 AI 的员工只填写第 1 维，其余维度记为“不适用”；缺失值不按 0 分处理。各维度单独显示有效样本数，有效维度不足时不绘制虚假的低分轮廓。</p></div></section></div>;
}

function StatusComposition({ items, total }: { items: Array<{ label: string; count: number }>; total: number }) {
  return <section className="admin-status-composition" aria-label="AI 使用状态构成"><div className="admin-status-numbers">{items.map((item, index) => <article key={item.label}><i data-index={index} /><span>{item.label}</span><strong>{item.count}</strong><small>{formatRatio(item.count, total)}</small></article>)}</div><div className="admin-status-stack" aria-label="AI 使用状态堆叠图">{items.map((item, index) => <span data-index={index} key={item.label} style={{ width: `${percent(item.count, total)}%` }} title={`${item.label} ${item.count}/${total}`} />)}</div></section>;
}

function TopList({ title, items, total }: { title: string; items: Array<{ label: string; count: number }>; total: number }) {
  return <section className="admin-top-list"><h3>{title}</h3>{items.length ? <ol>{items.slice(0, 5).map((item) => <li key={item.label}><div><span>{item.label}</span><b>{item.count}/{total}</b></div><i><span style={{ width: `${percent(item.count, total)}%` }} /></i><small>{formatRatio(item.count, total)}</small></li>)}</ol> : <p className="admin-muted">暂无有效数据</p>}</section>;
}

function CompactFacts({ title, items, total }: { title: string; items: Array<{ label: string; count: number }>; total: number }) {
  return <section className="admin-compact-facts"><h3>{title}</h3>{items.length ? <ul>{items.slice(0, 5).map((item) => <li key={item.label}><span>{item.label}</span><b>{item.count}/{total}</b></li>)}</ul> : <p className="admin-muted">暂无有效数据</p>}</section>;
}

function RadarChart({ dimensions }: { dimensions: DashboardDimensionStat[] }) {
  const center = { x: 160, y: 132 }; const radius = 88;
  const point = (index: number, ratio: number) => { const angle = -Math.PI / 2 + index * Math.PI / 3; return `${center.x + Math.cos(angle) * radius * ratio},${center.y + Math.sin(angle) * radius * ratio}`; };
  const valid = dimensions.filter((item) => item.average != null);
  const complete = dimensions.length === dimensionNames.length && valid.length === dimensions.length;
  return <figure className="admin-radar"><svg aria-label="员工画像六维雷达图" role="img" viewBox="0 0 320 280"><title>员工画像六维雷达图</title>{[1, 2, 3, 4, 5].map((level) => <polygon className="admin-radar__grid" key={level} points={dimensions.map((_, index) => point(index, level / 5)).join(' ')} />)}{dimensions.map((_, index) => <line className="admin-radar__axis" key={index} x1={center.x} x2={point(index, 1).split(',')[0]} y1={center.y} y2={point(index, 1).split(',')[1]} />)}{complete ? <polygon className="admin-radar__value" points={dimensions.map((item, index) => point(index, Math.min(1, Math.max(0, (item.average ?? 0) / 5)))).join(' ')} /> : null}{dimensionShortNames.map((name, index) => { const [x, y] = point(index, 1.3).split(',').map(Number); return <text key={name} textAnchor={x < 145 ? 'end' : x > 175 ? 'start' : 'middle'} x={x} y={y}>{name}</text>; })}</svg>{complete ? <figcaption>轮廓只表示六个维度的当前均值，不代表综合能力。</figcaption> : <figcaption>当前 {valid.length}/6 个维度有有效数据；缺失维度不按 0 分，暂不绘制轮廓</figcaption>}</figure>;
}

function percent(count: number, total: number) { return total > 0 ? Math.min(100, count / total * 100) : 0; }
function formatRatio(count: number, total: number) { return total > 0 ? `${Math.round(count / total * 100)}%` : '—'; }
function EmptyAnalysis() { return <PageState title="当前没有可展示的需求线索" description="聚合完成且版本有效后再展示 Agent 初步分析；固定统计和原始答卷仍可查看。" action={<div className="admin-source-actions"><Link to="/admin/employee-responses">员工答卷</Link><Link to="/admin/position-responses">负责人答卷</Link></div>} />; }
