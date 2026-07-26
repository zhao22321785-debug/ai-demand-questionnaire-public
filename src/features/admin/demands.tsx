import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import type { AggregateScenario } from '../../types/analysis';
import { AnalysisStateNotice, SampleWarning, ScenarioSourceLinks, Shell, completenessLabels, evidenceStatusLabels, scenarioSourceCount, useDashboard, valueLabel } from './shared';

type Tab = 'analysis' | 'evidence' | 'sources';
function readTab(value: string | null): Tab { return value === 'evidence' || value === 'sources' ? value : 'analysis'; }

export function DemandWorkbenchPage() {
  const { dashboard, error } = useDashboard();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [evidence, setEvidence] = useState('');
  const selectedId = params.get('selected');
  const tab = readTab(params.get('tab'));

  const select = (id?: string, nextTab: Tab = tab) => {
    const next = new URLSearchParams(params);
    id ? next.set('selected', id) : next.delete('selected');
    nextTab === 'analysis' ? next.delete('tab') : next.set('tab', nextTab);
    setParams(next);
  };

  const allScenarios = dashboard?.aggregateStatus === 'complete' ? dashboard.scenarios : [];
  const departments = useMemo(() => [...new Set(allScenarios.flatMap((scenario) => scenario.departments))], [allScenarios]);
  const positions = useMemo(() => [...new Set(allScenarios.flatMap((scenario) => scenario.positions))], [allScenarios]);
  const scenarios = allScenarios.filter((scenario) => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    return (!query || `${scenario.title} ${scenario.summary} ${scenario.capabilityTheme}`.toLocaleLowerCase('zh-CN').includes(query))
      && (!department || scenario.departments.includes(department))
      && (!position || scenario.positions.includes(position))
      && (!evidence || scenario.evidenceStatus === evidence);
  });
  const selected = scenarios.find((scenario) => scenario.id === selectedId) ?? (!selectedId ? scenarios[0] : undefined);

  useEffect(() => {
    if (selectedId || !scenarios[0]) return;
    const next = new URLSearchParams(params);
    next.set('selected', scenarios[0].id);
    setParams(next, { replace: true });
  }, [params, scenarios, selectedId, setParams]);

  if (error) return <Shell title="需求分析"><PageState tone="danger" title="需求分析暂时无法读取" description="请稍后刷新；原始答卷仍保持只读。" /></Shell>;
  if (!dashboard) return <Shell title="需求分析"><PageState title="正在读取需求场景" /></Shell>;

  const sampleInsufficient = dashboard.validAnalysisSourceCount < dashboard.minSampleSize;
  return <Shell title={selected?.title ?? '需求分析'} note={`${dashboard.batch.name} · Agent 初步分析`}>
    <p className="admin-page-intro">{selected ? '当前结论、事实信号与来源证据均保持只读和可追溯。' : '选择一条具体需求，查看初步判断、事实信号和来源证据。'}</p>
    <AnalysisStateNotice dashboard={dashboard} />
    {sampleInsufficient ? <SampleWarning minSampleSize={dashboard.minSampleSize} sourceCount={dashboard.validAnalysisSourceCount} /> : null}
    <DemandFilters search={search} onSearch={setSearch} department={department} onDepartment={setDepartment} position={position} onPosition={setPosition} evidence={evidence} onEvidence={setEvidence} departments={departments} positions={positions} />
    <div className="admin-workbench">
      <section className="admin-panel admin-workbench__list"><div className="admin-panel__header"><h2>具体需求</h2><span className="admin-muted">{scenarios.length} 项</span></div><div className="admin-panel__body">{scenarios.length ? <ul className="admin-demand-list">{scenarios.map((scenario) => <li key={scenario.id}><button aria-current={selected?.id === scenario.id ? 'true' : undefined} className={selected?.id === scenario.id ? 'is-selected' : ''} onClick={() => select(scenario.id)} type="button"><span className="admin-demand-list__top"><strong>{scenario.title}</strong><i className={`admin-evidence-dot admin-evidence-dot--${scenario.evidenceStatus}`} /></span><small>{scenario.summary}</small><span>{scenarioSourceCount(scenario)} 份来源 · {scenario.positions.join('、') || '岗位待补'}</span><em>{evidenceStatusLabels[scenario.evidenceStatus]}</em></button></li>)}</ul> : <PageState title="没有符合条件的需求" description={allScenarios.length ? '调整搜索或筛选条件后重试。' : '可先从原始答卷查看当前来源；有效聚合完成后再展示场景。'} />}</div></section>
      <section className="admin-panel admin-workbench__detail">{selected ? <DemandDetail scenario={selected} tab={tab} sampleSufficient={dashboard.sampleSufficient} onTab={(next) => select(selected.id, next)} /> : <div className="admin-panel__body"><PageState title="选择一条需求查看初步分析" description={selectedId ? '该需求不在当前筛选结果中，或其分析已失效。清除筛选后可重新选择。' : '选择后会同步到 URL，便于复制当前分析视图。'} /></div>}</section>
    </div>
  </Shell>;
}

function DemandFilters({ search, onSearch, department, onDepartment, position, onPosition, evidence, onEvidence, departments, positions }: { search: string; onSearch: (value: string) => void; department: string; onDepartment: (value: string) => void; position: string; onPosition: (value: string) => void; evidence: string; onEvidence: (value: string) => void; departments: string[]; positions: string[] }) {
  const active = Boolean(search || department || position || evidence);
  const clear = () => { onSearch(''); onDepartment(''); onPosition(''); onEvidence(''); };
  return <div className="admin-demand-filters" aria-label="需求筛选"><label className="admin-demand-search"><span>搜索</span><input aria-label="搜索需求" placeholder="搜索具体需求" type="search" value={search} onChange={(event) => onSearch(event.target.value)} /></label><label><span>部门</span><select aria-label="部门" value={department} onChange={(event) => onDepartment(event.target.value)}><option value="">全部部门</option>{departments.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>岗位</span><select aria-label="岗位" value={position} onChange={(event) => onPosition(event.target.value)}><option value="">全部岗位</option>{positions.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>证据</span><select aria-label="证据状态" value={evidence} onChange={(event) => onEvidence(event.target.value)}><option value="">全部证据状态</option>{Object.entries(evidenceStatusLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>{active ? <button className="admin-filter-clear" onClick={clear} type="button">清除筛选</button> : null}</div>;
}

function DemandDetail({ scenario, tab, sampleSufficient, onTab }: { scenario: AggregateScenario; tab: Tab; sampleSufficient: boolean; onTab: (tab: Tab) => void }) {
  const tabs: Array<[Tab, string]> = [['analysis', '分析结论'], ['evidence', '来源证据'], ['sources', '原始答卷']];
  return <><div className="admin-tabs" role="tablist" aria-label="需求详情">{tabs.map(([id, label]) => <button aria-selected={tab === id} key={id} onClick={() => onTab(id)} role="tab" type="button">{label}</button>)}</div><div className="admin-panel__body">{tab === 'analysis' ? <Analysis scenario={scenario} sampleSufficient={sampleSufficient} /> : tab === 'evidence' ? <Evidence scenario={scenario} /> : <ScenarioSourceLinks scenario={scenario} />}</div></>;
}

function Analysis({ scenario, sampleSufficient }: { scenario: AggregateScenario; sampleSufficient: boolean }) {
  const sourceBreakdown = `${scenarioSourceCount(scenario, 'employee_assessment')} 份员工来源 · ${scenarioSourceCount(scenario, 'position_survey')} 份负责人来源`;
  const path = [
    { number: '01', label: '实际任务', value: scenario.summary },
    { number: '02', label: '当前做法', value: scenario.currentProcess },
    { number: '03', label: '核心问题', value: scenario.mainProblem },
    { number: '04', label: '可能支持方向', value: sampleSufficient ? scenario.possibleSupport.join('；') || '仍需归纳' : '样本不足，暂不形成共性方向' },
    { number: '05', label: '建设前提', value: scenario.followUpQuestions.join('；') || '需结合真实业务样本验证效果与人工确认边界' },
  ];
  const support = sampleSufficient && scenario.possibleSupport.length ? `可继续核对“${scenario.possibleSupport.join('、')}”是否适合作为 AI 支持方向` : '当前只能保留可能的 AI 支持线索';
  return <article className="admin-demand-detail">
    <div className="admin-demand-primary"><section className="admin-agent-conclusion"><h2>Agent 初步分析</h2><p className="admin-agent-conclusion__lead">现有来源显示，这项工作{valueLabel(scenario.occurrence)}发生，当前做法主要是“{scenario.currentProcess}”，核心问题是“{scenario.mainProblem}”；{support}，因此值得继续了解，但在确认真实输入输出、系统数据条件和人工确认边界前，不能形成建设结论。</p><div className="admin-conclusion-tags"><span>{evidenceStatusLabels[scenario.evidenceStatus]}</span><span>{scenarioSourceCount(scenario)} 份有效来源</span><span>{scenario.positions.length} 个岗位</span><span>{completenessLabels[scenario.completeness]}</span></div><button className="admin-inline-link" onClick={() => document.getElementById('demand-path')?.scrollIntoView()} type="button">查看分析路径 ↓</button></section>
    <section className="admin-signal-board" aria-label="需求事实信号"><div className="admin-panel__header"><h3>事实信号</h3><span className="admin-muted">无综合评分</span></div><div className="admin-signal-grid"><Signal label="发生规律" value={valueLabel(scenario.occurrence)} note="固定字段" /><Signal label="步骤稳定" value={valueLabel(scenario.stability)} note="不等于可自动化" /><Signal label="覆盖人群 / 岗位" value={sampleSufficient ? `${scenario.coveredPeople} 人 · ${scenario.positions.length} 个岗位` : `${scenarioSourceCount(scenario)} 份来源`} note={sampleSufficient ? scenario.positions.join('、') : '小样本不形成共性'} /><Signal label="双方来源" value={sourceBreakdown} note="按来源 ID 去重" /><Signal label="信息完整度" value={completenessLabels[scenario.completeness]} note="离散规则" /></div></section></div>
    <section className="admin-analysis-path" id="demand-path"><div className="admin-panel__header"><h3>需求分析路径</h3><span className="admin-muted">事实 → 归纳 → 待验证条件</span></div><ol>{path.map((item) => <li key={item.number}><span>{item.number}</span><div><strong>{item.label}</strong><p>{item.value}</p></div></li>)}</ol></section>
    <div className="admin-demand-detail__sections"><section><h3>事实依据</h3><ul><li>{scenario.currentProcess}</li><li>{scenario.mainProblem}</li><li>{valueLabel(scenario.occurrence)}发生，{valueLabel(scenario.stability)}</li></ul></section><section><h3>原始期望与可能支持</h3><p>{scenario.originalExpectations.join('；') || '来源未说明具体期望。'}</p>{sampleSufficient ? <div className="admin-chip-list">{scenario.possibleSupport.map((item) => <span key={item}>{item}</span>)}</div> : <p className="admin-muted">样本不足，保留原始期望但不形成共性支持方向。</p>}</section><section className="admin-follow-up"><h3>后续需要了解</h3>{scenario.followUpQuestions.length ? <ol>{scenario.followUpQuestions.map((item) => <li key={item}>{item}</li>)}</ol> : <p>补充真实业务样本、验收标准和人工确认边界。</p>}</section></div>
    <p className="admin-disclaimer">Agent 初步分析仅用于收集线索，供管理员继续了解；不代表立项、审批、优先级或已确认方案。</p>
  </article>;
}

function Signal({ label, value, note }: { label: string; value: string; note: string }) { return <article><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }

function Evidence({ scenario }: { scenario: AggregateScenario }) {
  const employeeIds = [...new Set(scenario.employeeEvidence.map((item) => item.subjectId))];
  const positionIds = [...new Set(scenario.positionEvidence.map((item) => item.subjectId))];
  return <section className="admin-source-evidence"><header><h2>来源证据</h2><Link to={`/admin/differences?selected=${encodeURIComponent(scenario.id)}`}>进入证据对比 →</Link></header><p className="admin-chart-note">引用内容来自具体答卷；“未提及”只代表当前来源缺失，不表示观点冲突。</p><div className="admin-source-columns"><EvidenceColumn title="员工来源证据" tone="employee" items={scenario.employeeEvidence} empty="员工侧当前未提及。" /><EvidenceColumn title="负责人来源证据" tone="position" items={scenario.positionEvidence} empty="负责人侧当前未提及。" /></div><div className="admin-source-index"><section><h3>员工答卷入口</h3><ScenarioSourceLinks scenario={scenario} sourceIds={employeeIds} /></section><section><h3>负责人答卷入口</h3><ScenarioSourceLinks scenario={scenario} sourceIds={positionIds} /></section></div></section>;
}

function EvidenceColumn({ title, tone, items, empty }: { title: string; tone: 'employee' | 'position'; items: AggregateScenario['employeeEvidence']; empty: string }) {
  return <section className={`admin-quote-column admin-quote-column--${tone}`}><h3>{title}<span>{new Set(items.map((item) => item.subjectId)).size} 份来源</span></h3>{items.length ? <ul>{items.map((item, index) => <li key={`${item.subjectId}-${item.fieldPath}-${index}`}><blockquote>{typeof item.excerpt === 'string' ? item.excerpt : item.label}</blockquote><small>{item.label} · 来源修订 {item.revision}</small></li>)}</ul> : <p className="admin-muted">{empty}</p>}</section>;
}
