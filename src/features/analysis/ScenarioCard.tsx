import type { EvidenceReference, ScenarioAnalysis } from '../../types/analysis';
import { EvidenceLink } from './EvidenceLink';

interface ScenarioCardProps {
  scenario: ScenarioAnalysis;
  variant: 'employee' | 'position';
  onOpenEvidence?: (evidence: EvidenceReference) => void;
}

const completenessLabels = {
  complete: '信息较完整',
  partial: '部分信息缺失',
  insufficient: '暂不足以形成具体需求',
};

function Value({ children }: { children?: string }) {
  return <>{children || '暂不确定'}</>;
}

const factLabels: Record<string, string> = {
  daily: '几乎每天', weekly: '每周', monthly_stage: '每月或阶段性', project_event: '按项目或事件', irregular: '没有固定规律',
  unknown: '暂不确定', fixed: '基本固定', partly_fixed: '部分固定', variable: '变化较大', self: '主要是本人', single: '少数固定人员',
  same_position: '同岗位多人', cross_function: '多个岗位或部门',
};
function Fact({ value }: { value: string }) { return <>{factLabels[value] || value}</>; }

export function ScenarioCard({ scenario, variant, onOpenEvidence }: ScenarioCardProps) {
  return <article className="analysis-scenario-card">
    <p className="eyebrow">具体需求场景</p>
    <h3>{scenario.title}</h3>
    <dl className="analysis-scenario-card__details">
      <div><dt>任务与使用对象</dt><dd>{scenario.taskSummary}；<Fact value={scenario.audience} /></dd></div>
      <div><dt>当前做法</dt><dd>{scenario.currentProcess}</dd></div>
      <div><dt>主要问题</dt><dd>{scenario.mainProblem}</dd></div>
      <div><dt>任务事实信号</dt><dd>发生规律：<Fact value={scenario.occurrence} />；步骤稳定程度：<Fact value={scenario.stability} /></dd></div>
      <div><dt>负责人 / 填写者原始期望</dt><dd>{scenario.originalExpectation}</dd></div>
      <div><dt>可能支持方式</dt><dd>{scenario.supportForms.join('、') || '暂不确定'}</dd></div>
      {variant === 'position' ? <>
        <div><dt>常见输入 / 预期输出</dt><dd><Value>{scenario.commonInput}</Value> / <Value>{scenario.expectedOutput}</Value></dd></div>
        <div><dt>能力主题</dt><dd><Value>{scenario.capabilityTheme}</Value></dd></div>
        <div><dt>人工边界</dt><dd><Value>{scenario.humanBoundary}</Value></dd></div>
        <div><dt>协作关系</dt><dd><Value>{scenario.collaboration}</Value></dd></div>
      </> : null}
      <div><dt>完整度</dt><dd>{completenessLabels[scenario.completeness]}</dd></div>
      <div><dt>缺失信息</dt><dd>{scenario.missingInformation.join('；') || '无'}</dd></div>
      <div><dt>后续问题</dt><dd>{scenario.followUpQuestions.join('；') || '无'}</dd></div>
    </dl>
    <p className="analysis-scenario-card__reason">关注依据：{scenario.attentionReason}</p>
    <EvidenceLink evidence={scenario.evidence[0]} onOpenEvidence={onOpenEvidence} />
  </article>;
}
