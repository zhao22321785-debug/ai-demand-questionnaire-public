import type { EvidenceReference, PositionAnalysisResult } from '../../types/analysis';
import { ScenarioCard } from './ScenarioCard';
import './analysis.css';

interface PositionAnalysisViewProps {
  result: PositionAnalysisResult;
  onOpenEvidence?: (evidence: EvidenceReference) => void;
}

export function PositionAnalysisView({ result, onOpenEvidence }: PositionAnalysisViewProps) {
  return <section className="analysis-view" aria-labelledby="position-analysis-title">
    <header className="analysis-view__header">
      <p className="eyebrow">初步分析</p>
      <h2 id="position-analysis-title">岗位需求分析</h2>
      <p>{result.summary}</p>
    </header>
    <section className="analysis-view__section" aria-labelledby="position-work-summary-title">
      <h2 id="position-work-summary-title">岗位主要工作</h2>
      <ul>{result.workSummary.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
    <section aria-labelledby="position-scenarios-title">
      <h2 id="position-scenarios-title">共性任务与需求场景</h2>
      <div className="analysis-view__cards">{result.scenarios.map((scenario) => <ScenarioCard key={scenario.id} scenario={scenario} variant="position" onOpenEvidence={onOpenEvidence} />)}</div>
    </section>
    <section className="analysis-view__section" aria-labelledby="position-themes-title">
      <h2 id="position-themes-title">能力主题</h2>
      <ul>{result.capabilityThemes.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
    <section className="analysis-view__section" aria-labelledby="position-boundaries-title">
      <h2 id="position-boundaries-title">待进一步评估的人工与协作边界</h2>
      <ul>{result.boundariesToAssess.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
    <p className="analysis-view__disclaimer">本分析仅提供初步线索，不代表立项、优先级或技术可行性。{result.disclaimer}</p>
  </section>;
}
