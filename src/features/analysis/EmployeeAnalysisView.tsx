import type { EmployeeAnalysisResult, EvidenceReference } from '../../types/analysis';
import { ScenarioCard } from './ScenarioCard';
import './analysis.css';

interface EmployeeAnalysisViewProps {
  result: EmployeeAnalysisResult;
  onOpenEvidence?: (evidence: EvidenceReference) => void;
}

export function EmployeeAnalysisView({ result, onOpenEvidence }: EmployeeAnalysisViewProps) {
  return <section className="analysis-view" aria-labelledby="employee-analysis-title">
    <header className="analysis-view__header">
      <p className="eyebrow">初步分析</p>
      <h2 id="employee-analysis-title">个人需求分析</h2>
      <p>{result.summary}</p>
    </header>
    {result.hasExplicitDemand ? <section aria-labelledby="employee-scenarios-title">
      <h2 id="employee-scenarios-title">具体需求场景</h2>
      <div className="analysis-view__cards">{result.scenarios.map((scenario) => <ScenarioCard key={scenario.id} scenario={scenario} variant="employee" onOpenEvidence={onOpenEvidence} />)}</div>
    </section> : <section className="analysis-view__notice" aria-label="无明确需求状态">
      <h2>本次没有明确需求</h2>
      <p>本页仅回顾 AI 使用背景和行为，不生成具体需求场景卡。</p>
    </section>}
    <section className="analysis-view__section" aria-labelledby="employee-ai-background-title">
      <h2 id="employee-ai-background-title">AI 使用背景</h2>
      <ul>{result.aiUseBackground.length ? result.aiUseBackground.map((item) => <li key={item}>{item}</li>) : <li>未记录可供分析的 AI 使用背景。</li>}</ul>
    </section>
    <section className="analysis-view__section" aria-labelledby="employee-behavior-title">
      <h2 id="employee-behavior-title">行为回顾</h2>
      <ul>{result.behaviorProfile.map((item) => <li key={item}>{item}</li>)}</ul>
      <ul>{result.dimensionNotes.map((item) => <li key={item}>{item}</li>)}</ul>
      <p className="analysis-view__muted">行为回顾不代表绩效评价；未使用 AI 时，不适用维度不会被改写为低分。</p>
    </section>
    <p className="analysis-view__disclaimer">本分析仅提供初步线索，不代表立项、优先级或技术可行性。{result.disclaimer}</p>
  </section>;
}
