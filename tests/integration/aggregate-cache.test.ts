import { describe, expect, it, vi } from 'vitest';
import { runAggregateAnalysis } from '../../netlify/functions/_shared/aggregate-service';
import type { AggregateAnalysisResult, ModelClient } from '../../src/types/analysis';

const cachedResult: AggregateAnalysisResult = {
  kind: 'aggregate', batchId: 'batch-1', ruleVersion: 'aggregate-v2', sampleSize: 1, sampleSufficient: false,
  summary: '样本不足', scenarios: [], capabilityThemes: [], disclaimer: '初步分析',
};
const analysisRow = {
  id: 'analysis-1', subject_type: 'employee_assessment', subject_id: 'response-1', revision: 1,
  updated_at: '2026-07-24T00:00:00.000Z', result_payload: {
    kind: 'employee', subjectId: 'response-1', revision: 1, hasExplicitDemand: false,
    summary: '没有明确需求', departments: ['技术研发'], positions: ['研发工程师'], aiUseBackground: [], scenarios: [],
    behaviorProfile: [], dimensionNotes: [], disclaimer: '初步分析',
  },
};

function createClient(sourceSnapshot: unknown, options: { cachedPayload?: unknown; finalizeStatus?: string } = {}) {
  const writes = { inserts: 0, finalizations: [] as Array<{ name: string; args: Record<string, unknown> }> };
  const latest = () => ({ data: { source_snapshot: sourceSnapshot, result_payload: options.cachedPayload ?? cachedResult, status: 'complete' }, error: null });
  const activeBatch = () => ({ data: { id: 'batch-1' }, error: null });
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      writes.finalizations.push({ name, args });
      return Promise.resolve({ data: { status: options.finalizeStatus ?? 'complete' }, error: null });
    },
    from(table: string) {
      if (table === 'survey_batches') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: activeBatch }) }) }) }) };
      }
      if (table === 'employee_assessments') {
        return { select: () => ({ eq: () => ({ data: [{ id: 'response-1', revision: 1 }], error: null }) }) };
      }
      if (table === 'position_demand_surveys') {
        return { select: () => ({ eq: () => ({ data: [], error: null }) }) };
      }
      if (table === 'analysis_results') {
        return { select: () => ({ eq: () => ({ in: () => ({ data: [analysisRow], error: null }) }) }) };
      }
      if (table === 'aggregate_analysis_runs') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: latest }) }) }) }) }),
          update: () => ({ eq: () => ({ in: () => ({ error: null }) }) }),
          insert: () => {
            writes.inserts += 1;
            return { select: () => ({ single: async () => ({ data: { id: 'run-2' }, error: null }) }) };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { client, writes };
}

function model(): ModelClient {
  return { generateEmployeeAnalysis: vi.fn(), generatePositionAnalysis: vi.fn(), generateAggregateAnalysis: vi.fn() };
}

describe('aggregate cache snapshots', () => {
  it('invalidates aggregate-v1 cache after the scenario grouping contract changes', async () => {
    const { client, writes } = createClient([
      { ruleVersion: 'aggregate-v1', promptVersion: 'aggregate-v1', modelKey: 'configured-model', minSampleSize: 2 },
      { analysisResultId: 'analysis-1', subjectType: 'employee_assessment', subjectId: 'response-1', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z' },
    ]);

    await runAggregateAnalysis({ client: client as never, model: model(), modelKey: 'configured-model', minSampleSize: 2 });
    expect(writes.inserts).toBe(1);
  });

  it('reuses a jsonb snapshot with recursively reordered object keys without calling the model', async () => {
    const { client, writes } = createClient([
      { promptVersion: 'aggregate-v2', modelKey: 'configured-model', minSampleSize: 2, ruleVersion: 'aggregate-v2' },
      { updatedAt: '2026-07-24T00:00:00.000Z', revision: 1, subjectId: 'response-1', subjectType: 'employee_assessment', analysisResultId: 'analysis-1' },
    ]);
    const aggregateModel = model();

    await expect(runAggregateAnalysis({ client: client as never, model: aggregateModel, modelKey: 'configured-model', minSampleSize: 2 })).resolves.toEqual(cachedResult);
    expect(aggregateModel.generateAggregateAnalysis).not.toHaveBeenCalled();
    expect(writes.inserts).toBe(0);
  });

  it('invalidates a jsonb snapshot whose nested value changes', async () => {
    const { client, writes } = createClient([
      { ruleVersion: 'aggregate-v1', promptVersion: 'aggregate-v1', modelKey: 'different-model', minSampleSize: 2 },
      { analysisResultId: 'analysis-1', subjectType: 'employee_assessment', subjectId: 'response-1', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z' },
    ]);

    await runAggregateAnalysis({ client: client as never, model: model(), modelKey: 'configured-model', minSampleSize: 2 });
    expect(writes.inserts).toBe(1);
    expect(writes.finalizations[0]).toMatchObject({
      name: 'finalize_aggregate_analysis_run',
      args: { p_terminal_status: 'complete' },
    });
  });

  it('does not reuse a schema-invalid aggregate cache even when its snapshot matches', async () => {
    const snapshot = [
      { ruleVersion: 'aggregate-v1', promptVersion: 'aggregate-v1', modelKey: 'configured-model', minSampleSize: 2 },
      { analysisResultId: 'analysis-1', subjectType: 'employee_assessment', subjectId: 'response-1', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z' },
    ];
    const { client, writes } = createClient(snapshot, { cachedPayload: { kind: 'aggregate', batchId: 'batch-1' } });
    await runAggregateAnalysis({ client: client as never, model: model(), modelKey: 'configured-model', minSampleSize: 2 });
    expect(writes.inserts).toBe(1);
  });

  it('returns no current result when the atomic finalizer detects a stale snapshot', async () => {
    const { client } = createClient([{ changed: true }], { finalizeStatus: 'stale' });
    await expect(runAggregateAnalysis({ client: client as never, model: model(), modelKey: 'configured-model', minSampleSize: 2 })).resolves.toBeNull();
  });
});
