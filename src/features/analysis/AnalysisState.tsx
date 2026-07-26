import { PageState } from '../../components/feedback/PageState';
import type { AnalysisRecord } from '../../types/analysis';

interface AnalysisStateProps {
  analysis: AnalysisRecord | null;
}

export function AnalysisState({ analysis }: AnalysisStateProps) {
  if (!analysis || analysis.status === 'queued') return <PageState tone="warning" title="分析准备中" description="答卷已保存，系统正在准备分析。原始答卷仍可查看和修改。" />;
  if (analysis.status === 'running') return <PageState tone="warning" title="正在分析" description="分析完成后会在此更新；原始答卷仍可查看和修改。" />;
  if (analysis.status === 'stale') return <PageState tone="warning" title="分析需要更新" description="系统正在基于最新答卷重新分析，旧版结论未作为当前结论显示。" />;
  if (analysis.status === 'failed') return <PageState tone="danger" title="分析暂未完成" description={`${analysis.errorSummary || '分析服务暂时不可用。'} 原始答卷仍可查看和修改。`} />;
  return <PageState tone="success" title="分析已更新" description="当前展示的是与答卷版本一致的初步分析线索。" />;
}
