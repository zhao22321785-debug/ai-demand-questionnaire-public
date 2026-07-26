import { useEffect, useState } from 'react';
import { useDataClient } from '../../lib/data';
import type { AnalysisRecord, SubjectType } from '../../types/analysis';

const POLL_INTERVAL_MS = 2_000;

export function useAnalysisRecord(subjectType: SubjectType, subjectId?: string) {
  const client = useDataClient();
  const [analysis, setAnalysis] = useState<AnalysisRecord | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const result = subjectId ? await client.getAnalysis(subjectType, subjectId) : null;
        if (!active) return;
        setAnalysis(result);
        setError('');
        if (!result || ['queued', 'running', 'stale'].includes(result.status)) timer = window.setTimeout(load, POLL_INTERVAL_MS);
      } catch {
        if (active) {
          setError('暂时无法读取分析状态，请稍后刷新页面。');
          setAnalysis(null);
        }
      }
    };
    void load();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [client, subjectId, subjectType]);

  return { analysis, error };
}
