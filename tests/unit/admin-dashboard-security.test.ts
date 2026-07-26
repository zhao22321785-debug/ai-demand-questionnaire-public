import { safeAggregateDashboardResult } from '../../netlify/functions/admin-dashboard';
import source from '../../netlify/functions/admin-dashboard.ts?raw';

const valid = {
  kind: 'aggregate', batchId: 'batch-1', ruleVersion: 'aggregate-v1', sampleSize: 3, sampleSufficient: true,
  summary: '初步线索', scenarios: [], capabilityThemes: [], disclaimer: '初步分析',
};

it.each(['queued', 'running', 'failed', 'stale'])('forces the aggregate payload empty for %s runs', (status) => {
  expect(safeAggregateDashboardResult(status, valid)).toBeUndefined();
});

it('forces a schema-invalid complete payload empty', () => {
  expect(safeAggregateDashboardResult('complete', { ...valid, scenarios: 'not-an-array' })).toBeUndefined();
});

it('accepts only a schema-valid complete payload', () => {
  expect(safeAggregateDashboardResult('complete', valid)).toEqual(valid);
});

it('returns complete analysis sources separately from all valid responses', () => {
  expect(source).toMatch(/validAnalysisSourceCount:\s*analysisStatuses\.get\('complete'\)\s*\|\|\s*0/i);
});
