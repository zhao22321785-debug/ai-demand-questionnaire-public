import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import { SurveyLayout } from '../../components/layout/SurveyLayout';
import { useDataClient } from '../../lib/data';
import type { AnalysisStatus, ResponseSummary } from '../../types/survey';

const statusLabels: Record<AnalysisStatus, string> = { pending: '分析准备中', running: '分析中', complete: '分析完成', failed: '分析失败', stale: '分析已过期' };

export function MyResponsesPage() {
  const client = useDataClient(); const [responses, setResponses] = useState<ResponseSummary[] | null>(null); const [error, setError] = useState(false);
  useEffect(() => { let active = true; void client.listMyResponses().then((items) => { if (active) setResponses(items); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [client]);
  return <SurveyLayout module="我的答卷"><section className="responses-page"><p className="eyebrow">当前调研批次</p><h1>我的答卷</h1><p>同一批次再次保存会更新原记录，不会生成重复的有效答卷。</p>{error ? <PageState tone="danger" title="答卷暂时无法读取" /> : responses === null ? <PageState title="正在读取答卷" /> : responses.length === 0 ? <PageState title="还没有答卷" description="您可以从员工或岗位负责人视角开始填写。" action={<div className="responses-actions"><Link to="/survey/employee">填写员工问卷 →</Link><Link to="/survey/position">填写岗位问卷 →</Link></div>} /> : <div className="response-list">{responses.map((response) => <article key={response.id}><div><span>{response.type === 'employee' ? '员工需求调研' : '岗位需求调研'}</span><h2>{response.title}</h2><p>{response.subtitle} · 第 {response.revision} 版</p></div><div><span className={`response-status response-status--${response.analysisStatus}`}>{statusLabels[response.analysisStatus]}</span><Link to={`/survey/responses/${response.type}/${response.id}`}>查看复盘 →</Link></div></article>)}</div>}<div className="responses-actions"><Link to="/survey/identity">返回身份选择</Link></div></section></SurveyLayout>;
}
