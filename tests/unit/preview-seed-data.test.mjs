import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as previewSeed from '../../scripts/preview-seed-data.mjs';
import {
  SEED_PREFIX,
  buildPreviewSeed,
  runPreviewSeedOrchestration,
  selectPreviewSeedUsers,
  validatePreviewTarget,
  validateSupabaseTarget,
} from '../../scripts/preview-seed-data.mjs';

const referenceFixture = {
  activeBatch: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'M1 预览批次',
    employeeSurveyVersionId: '00000000-0000-4000-8000-000000000002',
    positionSurveyVersionId: '00000000-0000-4000-8000-000000000003',
  },
  departments: [
    { id: '00000000-0000-4000-8000-000000000011', code: 'product', label: '产品与运营' },
    { id: '00000000-0000-4000-8000-000000000012', code: 'engineering', label: '技术研发' },
    { id: '00000000-0000-4000-8000-000000000013', code: 'quality', label: '质量保障' },
  ],
  positions: [
    { id: '00000000-0000-4000-8000-000000000021', code: 'product_manager', label: '产品经理' },
    { id: '00000000-0000-4000-8000-000000000022', code: 'engineer', label: '研发工程师' },
    { id: '00000000-0000-4000-8000-000000000023', code: 'test_engineer', label: '测试工程师' },
  ],
  aiTools: [
    { id: '00000000-0000-4000-8000-000000000031', code: 'chatgpt', label: 'ChatGPT' },
    { id: '00000000-0000-4000-8000-000000000032', code: 'copilot', label: 'GitHub Copilot' },
  ],
};

describe('preview target guards', () => {
  it('accepts only the approved Supabase project and exact HTTPS Preview alias', () => {
    expect(validateSupabaseTarget('https://exampleprojectref123.supabase.co')).toBe('https://exampleprojectref123.supabase.co');
    expect(validatePreviewTarget('https://public-preview--ai-demand-questionnaire.netlify.app')).toBe('https://public-preview--ai-demand-questionnaire.netlify.app');
  });

  it.each([
    'http://exampleprojectref123.supabase.co',
    'https://another-project.supabase.co',
    'https://exampleprojectref123.supabase.co.attacker.example',
    'https://user:password@exampleprojectref123.supabase.co',
  ])('rejects unsafe Supabase target %s', (target) => {
    expect(() => validateSupabaseTarget(target)).toThrow(/Supabase/);
  });

  it.each([
    'https://ai-demand-questionnaire-preview.netlify.app',
    'https://public-preview--ai-demand-questionnaire.netlify.app.attacker.example',
    'https://user:password@public-preview--ai-demand-questionnaire.netlify.app',
    'http://public-preview--ai-demand-questionnaire.netlify.app',
    'http://localhost:8888',
    'https://127.0.0.1:9999',
  ])('rejects production, credentialed, or lookalike Preview target %s', (target) => {
    expect(() => validatePreviewTarget(target)).toThrow(/Preview/);
  });
});

describe('preview seed create-once boundary', () => {
  it('does not expose replace or cleanup commands', () => {
    const cli = readFileSync(resolve(process.cwd(), 'scripts/seed-preview-data.mjs'), 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(cli).not.toContain('--replace');
    expect(packageJson.scripts).not.toHaveProperty('cleanup:preview-seed');
    expect(existsSync(resolve(process.cwd(), 'scripts/cleanup-preview-data.mjs'))).toBe(false);
  });

  it('runs remote preflight before client creation and includes postcondition reads', () => {
    const cli = readFileSync(resolve(process.cwd(), 'scripts/seed-preview-data.mjs'), 'utf8');
    const main = cli.slice(cli.indexOf('async function main()'));
    const preflight = main.indexOf("'/api/internal/preview-seed-preflight'");
    const createClients = main.indexOf('createSupabaseClients(config)');

    expect(preflight).toBeGreaterThan(-1);
    expect(createClients).toBeGreaterThan(preflight);
    expect(cli).toContain("from('analysis_results')");
    expect(cli).toContain("from('aggregate_analysis_runs')");
    expect(main).toContain('formatPreviewSeedSummary({');
    expect(main).toContain('aggregateStatus: result.aggregation.status');
  });
});

describe('preview seed user selection', () => {
  it('selects only emails beginning with the exact fixed seed prefix', () => {
    const selected = selectPreviewSeedUsers([
      { id: 'seed-user', email: `${SEED_PREFIX}employee-01@example.com` },
      { id: 'personal-user', email: 'personal@example.com' },
      { id: 'main-preview', email: 'preview-main-user@example.com' },
      { id: 'lookalike-before', email: `x${SEED_PREFIX}employee-01@example.com` },
      { id: 'lookalike-date', email: 'preview-seed-2026072-employee-01@example.com' },
      { id: 'missing-email' },
    ]);
    expect(selected.map((user) => user.id)).toEqual(['seed-user']);
  });
});

describe('preview seed fixture', () => {
  it('builds ten distinct users with seven employee and three position responses', () => {
    const seed = buildPreviewSeed(referenceFixture);
    expect(seed).toHaveLength(10);
    expect(new Set(seed.map((item) => item.email)).size).toBe(10);
    expect(seed.filter((item) => item.kind === 'employee')).toHaveLength(7);
    expect(seed.filter((item) => item.kind === 'position')).toHaveLength(3);
    expect(seed.every((item) => item.email.startsWith(SEED_PREFIX))).toBe(true);
  });

  it('aligns every position survey with at least one seeded employee position', () => {
    const seed = buildPreviewSeed(referenceFixture);
    const employeePositions = new Set(seed.filter((item) => item.kind === 'employee').map((item) => item.profile.positionId));
    expect(seed.filter((item) => item.kind === 'position').every((item) => employeePositions.has(item.payload.positionId))).toBe(true);
  });

  it('covers all employee usage branches with branch-consistent evidence', () => {
    const employees = buildPreviewSeed(referenceFixture).filter((item) => item.kind === 'employee');
    expect(new Set(employees.map((item) => item.payload.aiUseStatus))).toEqual(new Set([
      'never',
      'tried_rarely',
      'sometimes',
      'frequent',
    ]));

    const never = employees.find((item) => item.payload.aiUseStatus === 'never');
    expect(never.payload.nonUseReasons.length).toBeGreaterThan(0);
    expect(never.payload.discontinuationReasons).toEqual([]);
    expect(never.payload.aiToolIds).toEqual([]);
    expect(never.payload.aiScenarios).toEqual([]);
    expect(never.payload.tasks.length).toBeGreaterThan(0);
    expect(never.payload.tasks.every((task) => task.aiUseStatus === 'never' && task.aiFollowUp === undefined)).toBe(true);
    expect(never.payload.dimensions).toEqual([expect.any(Number), null, null, null, null, null]);

    const triedRarely = employees.find((item) => item.payload.aiUseStatus === 'tried_rarely');
    expect(triedRarely.payload.discontinuationReasons.length).toBeGreaterThan(0);
    expect(triedRarely.payload.aiToolIds.length).toBeGreaterThan(0);
    expect(triedRarely.payload.aiScenarios.length).toBeGreaterThan(0);
    expect(triedRarely.payload.tasks.some((task) => task.aiUseStatus === 'stopped' && task.aiFollowUp)).toBe(true);
  });

  it('uses controlled dimension differences instead of one repeated employee answer array', () => {
    const employees = buildPreviewSeed(referenceFixture).filter((item) => item.kind === 'employee');
    expect(new Set(employees.map((item) => JSON.stringify(item.payload.dimensions))).size).toBeGreaterThan(1);
    expect(employees.filter((item) => item.payload.aiUseStatus !== 'never').every((item) => (
      item.payload.dimensions.every((answer) => Number.isInteger(answer))
    ))).toBe(true);
  });
});

describe('preview seed orchestration failure preservation', () => {
  it('preserves partial users, stops later stages, and exposes only safe progress metadata', async () => {
    let aggregateCalls = 0;
    let dispatchCalls = 0;
    let waitCalls = 0;
    const fixtures = [{ key: 'first' }, { key: 'second' }];

    let failure;
    try {
      await runPreviewSeedOrchestration({
        fixtures,
        createAndSave: async (fixture, recordCreatedUser) => {
          const userId = `current-${fixture.key}`;
          recordCreatedUser(userId);
          if (fixture.key === 'second') throw new Error('secret-bearing upstream detail');
          return { userId, subjectType: 'employee_assessment', subjectId: '00000000-0000-4000-8000-000000000041', revision: 1 };
        },
        dispatchAnalyses: async () => { dispatchCalls += 1; },
        waitForAnalysis: async () => { waitCalls += 1; },
        aggregate: async () => { aggregateCalls += 1; },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: 'PreviewSeedStageError',
      stage: 'save',
      progress: {
        createdUserIds: ['current-first', 'current-second'],
        subjects: [{
          userId: 'current-first',
          subjectType: 'employee_assessment',
          subjectId: '00000000-0000-4000-8000-000000000041',
          revision: 1,
        }],
      },
    });
    expect(failure.message).not.toContain('secret-bearing upstream detail');
    expect(failure.cause).toBeUndefined();
    expect(dispatchCalls).toBe(0);
    expect(waitCalls).toBe(0);
    expect(aggregateCalls).toBe(0);
  });
});

describe('preview seed internal request guards', () => {
  it('treats an empty 202 background-function response as accepted', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }));

    await expect(previewSeed.requestInternalJson({
      previewOrigin: 'https://public-preview--ai-demand-questionnaire.netlify.app',
      internalSecret: 'test-only-secret',
    }, '/api/internal/analyze-background', { fetcher, timeoutMs: 1_000 }))
      .resolves.toEqual({ accepted: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect without making a second request', async () => {
    expect(typeof previewSeed.requestInternalJson).toBe('function');
    const fetcher = vi.fn(async (_url, init) => {
      expect(init.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { location: 'https://attacker.example/collect' } });
    });

    await expect(previewSeed.requestInternalJson({
      previewOrigin: 'https://public-preview--ai-demand-questionnaire.netlify.app',
      internalSecret: 'test-only-secret',
    }, '/api/internal/preview-seed-preflight', { method: 'GET', fetcher, timeoutMs: 1_000 }))
      .rejects.toThrow(/重定向/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requires accepted=true and rejects an empty aggregate result', () => {
    expect(typeof previewSeed.validateAcceptedInternalResponse).toBe('function');
    expect(typeof previewSeed.validateAggregateResponse).toBe('function');
    expect(() => previewSeed.validateAcceptedInternalResponse({ accepted: false }, 'analysis')).toThrow(/accepted/);
    expect(() => previewSeed.validateAggregateResponse({ accepted: true, result: 'empty' })).toThrow(/updated/);
    expect(previewSeed.validateAggregateResponse({ accepted: true, result: 'updated' })).toEqual({
      accepted: true,
      result: 'updated',
    });
  });

  it('waits for the background aggregate run to become complete', async () => {
    const subjects = [{
      subjectType: 'employee_assessment',
      subjectId: '00000000-0000-4000-8000-000000000041',
      revision: 1,
    }];
    const loadLatest = vi.fn()
      .mockResolvedValueOnce({ status: 'running', model_key: 'deterministic-mock', source_snapshot: [] })
      .mockResolvedValueOnce({
        status: 'complete',
        model_key: 'deterministic-mock',
        source_snapshot: [{
          subjectType: subjects[0].subjectType,
          subjectId: subjects[0].subjectId,
          revision: subjects[0].revision,
        }],
      });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(previewSeed.waitForVerifiedAggregate(loadLatest, subjects, {
      deadlineMs: 1_000,
      pollIntervalMs: 1,
      sleep,
    })).resolves.toEqual({ status: 'complete', totalSourceCount: 1 });
    expect(loadLatest).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe('preview seed success summary', () => {
  it('formats stable line-by-line counts from the verified result', () => {
    expect(typeof previewSeed.formatPreviewSeedSummary).toBe('function');
    expect(previewSeed.formatPreviewSeedSummary({
      createdUsers: 10,
      employeeResponses: 7,
      positionResponses: 3,
      completeCurrentAnalysis: 10,
      failedOrNonterminalJobs: 0,
      aggregateStatus: 'complete',
      aggregateTotalSourceCount: 12,
    })).toBe([
      'created_users=10',
      'employee_responses=7',
      'position_responses=3',
      'complete_current_analysis=10',
      'failed_or_nonterminal_jobs=0',
      'aggregate_status=complete',
      'aggregate_total_source_count=12',
    ].join('\n'));
  });
});

describe('preview seed postconditions', () => {
  const subjects = [
    { subjectType: 'employee_assessment', subjectId: '00000000-0000-4000-8000-000000000041', revision: 1 },
    { subjectType: 'position_survey', subjectId: '00000000-0000-4000-8000-000000000042', revision: 2 },
  ];

  it('rejects a preflight that is not the approved branch/deploy-preview mock runtime', () => {
    expect(typeof previewSeed.validatePreviewSeedPreflight).toBe('function');
    expect(() => previewSeed.validatePreviewSeedPreflight({
      accepted: true,
      deployContext: 'branch-deploy',
      supabaseProjectRef: 'exampleprojectref123',
      supabaseHost: 'exampleprojectref123.supabase.co',
      modelKey: 'gpt-test',
    })).toThrow(/deterministic-mock/);
  });

  it('rejects missing or wrong-model current analysis rows', () => {
    expect(typeof previewSeed.validateAnalysisResults).toBe('function');
    const validEmployee = {
      subject_type: 'employee_assessment',
      subject_id: subjects[0].subjectId,
      revision: 1,
      status: 'complete',
      model_key: 'deterministic-mock',
    };
    expect(() => previewSeed.validateAnalysisResults([validEmployee], subjects)).toThrow(/缺少/);
    expect(() => previewSeed.validateAnalysisResults([
      validEmployee,
      {
        subject_type: 'position_survey',
        subject_id: subjects[1].subjectId,
        revision: 2,
        status: 'complete',
        model_key: 'gpt-test',
      },
    ], subjects)).toThrow(/deterministic-mock/);
  });

  it('requires the latest aggregate run to contain every seeded subject revision', () => {
    expect(typeof previewSeed.validateAggregateRun).toBe('function');
    const missingPosition = {
      status: 'complete',
      model_key: 'deterministic-mock',
      source_snapshot: [
        { modelKey: 'deterministic-mock' },
        { subjectType: 'employee_assessment', subjectId: subjects[0].subjectId, revision: 1 },
      ],
    };
    expect(() => previewSeed.validateAggregateRun(missingPosition, subjects)).toThrow(/缺少/);

    expect(previewSeed.validateAggregateRun({
      ...missingPosition,
      source_snapshot: [
        ...missingPosition.source_snapshot,
        { subjectType: 'position_survey', subjectId: subjects[1].subjectId, revision: 2 },
        { subjectType: 'employee_assessment', subjectId: '00000000-0000-4000-8000-000000000099', revision: 1 },
      ],
    }, subjects)).toEqual({ status: 'complete', totalSourceCount: 3 });
  });
});
