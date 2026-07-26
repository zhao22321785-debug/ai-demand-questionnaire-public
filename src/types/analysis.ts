import { z } from 'zod';

export type SubjectType = 'employee_assessment' | 'position_survey';
export type AnalysisJobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'stale';
export type AnalysisCompleteness = 'complete' | 'partial' | 'insufficient';
export type AggregateStatus = 'pending' | 'running' | 'complete' | 'failed' | 'stale';
export type EvidenceComparisonStatus =
  | 'both_supported'
  | 'employee_only'
  | 'position_evidence_low'
  | 'explicit_conflict'
  | 'insufficient_sample';
export const EVIDENCE_DIMENSIONS = [
  'task_context',
  'main_problem',
  'expected_support',
  'human_boundary',
  'system_data_conditions',
] as const;
export type EvidenceDimension = typeof EVIDENCE_DIMENSIONS[number];
export const EVIDENCE_COMPARISON_RELATIONS = [
  'both_mentioned',
  'complementary',
  'direction_aligned',
  'employee_supplement',
  'position_supplement',
  'employee_missing',
  'position_missing',
  'both_missing',
  'explicit_conflict',
  'insufficient_sample',
] as const;
export type EvidenceComparisonRelation = typeof EVIDENCE_COMPARISON_RELATIONS[number];

export interface AnalysisRequest {
  subjectType: SubjectType;
  subjectId: string;
  revision: number;
}

export interface ModelConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxOutputTokens?: number;
  maxRetryDelayMs?: number;
}

export const ANALYSIS_MAX_TEXT_LENGTH = 4_000;
export const ANALYSIS_MAX_EXCERPT_LENGTH = 2_000;
export const ANALYSIS_MAX_ARRAY_ITEMS = 20;
export const ANALYSIS_MAX_SCENARIOS = 20;
export const ANALYSIS_MAX_EVIDENCE_ITEMS = 20;

const idString = z.string().min(1).max(200);
const textString = z.string().min(1).max(ANALYSIS_MAX_TEXT_LENGTH);
const optionalTextString = z.string().max(ANALYSIS_MAX_TEXT_LENGTH).optional();
const textArray = z.array(textString).max(ANALYSIS_MAX_ARRAY_ITEMS);

export const EvidenceReferenceSchema = z.object({
  subjectType: z.enum(['employee_assessment', 'position_survey']),
  subjectId: idString,
  revision: z.number().int().positive(),
  fieldPath: z.string().min(1).max(500),
  taskId: z.preprocess((value) => value === null ? undefined : value, idString.optional()),
  label: z.string().min(1).max(500),
  excerpt: z.preprocess((value) => value === null ? undefined : value, z.string().min(1).max(ANALYSIS_MAX_EXCERPT_LENGTH).optional()),
}).strict();

export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

const ScenarioAnalysisSchema = z.object({
  id: idString,
  title: textString,
  audience: textString,
  taskSummary: textString,
  currentProcess: textString,
  mainProblem: textString,
  occurrence: textString,
  stability: textString,
  originalExpectation: textString,
  supportForms: textArray,
  attentionReason: textString,
  completeness: z.enum(['complete', 'partial', 'insufficient']),
  missingInformation: textArray,
  followUpQuestions: textArray,
  evidence: z.array(EvidenceReferenceSchema).min(1).max(ANALYSIS_MAX_EVIDENCE_ITEMS),
  commonInput: z.preprocess((value) => value === null ? undefined : value, optionalTextString),
  expectedOutput: z.preprocess((value) => value === null ? undefined : value, optionalTextString),
  humanBoundary: z.preprocess((value) => value === null ? undefined : value, optionalTextString),
  collaboration: z.preprocess((value) => value === null ? undefined : value, optionalTextString),
  capabilityTheme: z.preprocess((value) => value === null ? undefined : value, optionalTextString),
}).strict();

export type ScenarioAnalysis = z.infer<typeof ScenarioAnalysisSchema>;

export const EmployeeAnalysisInputSchema = z.object({
  subjectType: z.literal('employee_assessment'),
  subjectId: idString,
  revision: z.number().int().positive(),
  respondent: z.object({
    department: textString,
    position: textString,
    experience: textString,
  }).strict(),
  aiUseStatus: textString,
  aiUseBackground: z.array(z.string().max(ANALYSIS_MAX_TEXT_LENGTH)).max(ANALYSIS_MAX_ARRAY_ITEMS * 4),
  backgroundEvidence: z.object({
    nonUseReasons: textArray,
    discontinuationReasons: textArray,
    aiScenarios: textArray,
    painPoints: textArray,
  }).strict(),
  hasExplicitDemand: z.boolean(),
  tasks: z.array(z.object({
    id: idString,
    title: textString,
    currentProcess: textString,
    mainProblem: textString,
    occurrence: textString,
    stability: textString,
    audience: textString,
    aiUseStatus: textString,
    aiFollowUp: optionalTextString,
    expectedSupport: textString,
  }).strict()).max(ANALYSIS_MAX_ARRAY_ITEMS),
  dimensions: z.array(z.number().int().min(1).max(5).nullable()).length(6),
  allowedEvidencePaths: z.array(z.string().min(1).max(500)).max(200),
}).strict();

export const PositionAnalysisInputSchema = z.object({
  subjectType: z.literal('position_survey'),
  subjectId: idString,
  revision: z.number().int().positive(),
  position: z.object({
    department: textString,
    name: textString,
    experience: textString,
  }).strict(),
  workItems: z.array(z.object({
    id: idString,
    name: textString,
    description: textString,
    selectedForImprovement: z.boolean(),
  }).strict()).max(ANALYSIS_MAX_ARRAY_ITEMS),
  tasks: z.array(z.object({
    id: idString,
    workItemId: idString,
    task: textString,
    commonInput: z.string().max(ANALYSIS_MAX_TEXT_LENGTH),
    hasFixedInput: z.boolean(),
    output: z.string().max(ANALYSIS_MAX_TEXT_LENGTH),
    hasFixedOutput: z.boolean(),
    currentProcess: textString,
    mainProblem: textString,
    occurrence: textString,
    stability: textString,
    audience: textString,
    aiParticipation: textString,
    expectedAiSupport: textString,
    resultUsage: textString,
    humanReviewContent: optionalTextString,
    collaboration: z.array(z.string().max(ANALYSIS_MAX_TEXT_LENGTH)).max(ANALYSIS_MAX_ARRAY_ITEMS),
  }).strict()).max(ANALYSIS_MAX_ARRAY_ITEMS),
  allowedEvidencePaths: z.array(z.string().min(1).max(500)).max(200),
}).strict();

export const EmployeeAnalysisResultSchema = z.object({
  kind: z.literal('employee'),
  subjectId: idString,
  revision: z.number().int().positive(),
  hasExplicitDemand: z.boolean(),
  summary: textString,
  departments: textArray.min(1),
  positions: textArray.min(1),
  aiUseBackground: textArray,
  scenarios: z.array(ScenarioAnalysisSchema).max(ANALYSIS_MAX_SCENARIOS),
  behaviorProfile: textArray,
  dimensionNotes: textArray,
  disclaimer: textString,
}).strict().superRefine((value, context) => {
  if (!value.hasExplicitDemand && value.scenarios.length > 0) {
    context.addIssue({ code: 'custom', path: ['scenarios'], message: '没有明确需求时不得生成需求场景' });
  }
});

export const PositionAnalysisResultSchema = z.object({
  kind: z.literal('position'),
  subjectId: idString,
  revision: z.number().int().positive(),
  summary: textString,
  departments: textArray.min(1),
  positions: textArray.min(1),
  workSummary: textArray,
  scenarios: z.array(ScenarioAnalysisSchema).max(ANALYSIS_MAX_SCENARIOS),
  capabilityThemes: textArray,
  boundariesToAssess: textArray,
  disclaimer: textString,
}).strict();

export type EmployeeAnalysisInput = z.infer<typeof EmployeeAnalysisInputSchema>;
export type PositionAnalysisInput = z.infer<typeof PositionAnalysisInputSchema>;
export type EmployeeAnalysisResult = z.infer<typeof EmployeeAnalysisResultSchema>;
export type PositionAnalysisResult = z.infer<typeof PositionAnalysisResultSchema>;
export type SingleAnalysisResult = EmployeeAnalysisResult | PositionAnalysisResult;
export const SingleAnalysisResultSchema = z.discriminatedUnion('kind', [EmployeeAnalysisResultSchema, PositionAnalysisResultSchema]);

export interface AnalysisRecord {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  revision: number;
  status: AnalysisJobStatus;
  result: SingleAnalysisResult | null;
  attemptCount: number;
  errorCode?: string;
  errorSummary?: string;
  modelKey?: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
}

export const AggregateAnalysisInputSchema = z.object({
  batchId: idString,
  ruleVersion: idString,
  minSampleSize: z.number().int().positive(),
  analyses: z.array(SingleAnalysisResultSchema).max(200),
}).strict();

const AggregateSourceSchema = z.object({
  subjectType: z.enum(['employee_assessment', 'position_survey']),
  subjectId: idString,
  revision: z.number().int().positive(),
  title: textString,
  route: z.string().min(1).max(1_000),
}).strict();

export const EvidenceDimensionComparisonSchema = z.object({
  dimension: z.enum(EVIDENCE_DIMENSIONS),
  employeeSourceCount: z.number().int().nonnegative(),
  employeeSourceTotal: z.number().int().nonnegative(),
  positionSourceCount: z.number().int().nonnegative(),
  positionSourceTotal: z.number().int().nonnegative(),
  relation: z.enum(EVIDENCE_COMPARISON_RELATIONS),
  employeeSummary: z.string().max(ANALYSIS_MAX_TEXT_LENGTH),
  positionSummary: z.string().max(ANALYSIS_MAX_TEXT_LENGTH),
  employeeSourceIds: z.array(idString).max(ANALYSIS_MAX_EVIDENCE_ITEMS),
  positionSourceIds: z.array(idString).max(ANALYSIS_MAX_EVIDENCE_ITEMS),
}).strict();

export type EvidenceDimensionComparison = z.infer<typeof EvidenceDimensionComparisonSchema>;

const EvidenceDimensionsSchema = z.array(EvidenceDimensionComparisonSchema)
  .max(EVIDENCE_DIMENSIONS.length)
  .default([])
  .superRefine((dimensions, context) => {
    if (dimensions.length === 0) return;
    if (dimensions.length !== EVIDENCE_DIMENSIONS.length) {
      context.addIssue({ code: 'custom', message: '证据比较必须包含完整五维' });
      return;
    }
    dimensions.forEach((dimension, index) => {
      if (dimension.dimension !== EVIDENCE_DIMENSIONS[index]) {
        context.addIssue({ code: 'custom', path: [index, 'dimension'], message: '证据比较维度缺失、重复或顺序错误' });
      }
    });
  });

export const AggregateScenarioSchema = z.object({
  id: idString,
  title: textString,
  capabilityTheme: textString,
  summary: textString,
  currentProcess: textString,
  mainProblem: textString,
  occurrence: textString,
  stability: textString,
  audience: textString,
  originalExpectations: textArray,
  possibleSupport: textArray,
  departments: textArray,
  positions: textArray,
  responseCount: z.number().int().nonnegative(),
  coveredPeople: z.number().int().nonnegative(),
  employeeEvidence: z.array(EvidenceReferenceSchema).max(ANALYSIS_MAX_EVIDENCE_ITEMS),
  positionEvidence: z.array(EvidenceReferenceSchema).max(ANALYSIS_MAX_EVIDENCE_ITEMS),
  evidenceStatus: z.enum(['both_supported', 'employee_only', 'position_evidence_low', 'explicit_conflict', 'insufficient_sample']),
  completeness: z.enum(['complete', 'partial', 'insufficient']),
  followUpQuestions: textArray,
  sources: z.array(AggregateSourceSchema).min(1).max(ANALYSIS_MAX_EVIDENCE_ITEMS),
  evidenceDimensions: EvidenceDimensionsSchema,
}).strict();

// The new field stays optional at producer boundaries so deterministic/mock producers and
// old cached payloads remain source-compatible. Parsing always returns evidenceDimensions: [].
type ParsedAggregateScenario = z.infer<typeof AggregateScenarioSchema>;
export type AggregateScenario = Omit<ParsedAggregateScenario, 'evidenceDimensions'> & {
  evidenceDimensions?: EvidenceDimensionComparison[];
};

export const AggregateAnalysisResultSchema = z.object({
  kind: z.literal('aggregate'),
  batchId: idString,
  ruleVersion: idString,
  sampleSize: z.number().int().nonnegative(),
  sampleSufficient: z.boolean(),
  summary: textString,
  scenarios: z.array(AggregateScenarioSchema).max(ANALYSIS_MAX_SCENARIOS),
  capabilityThemes: z.array(z.object({
    id: idString,
    title: textString,
    scenarioIds: z.array(idString).max(ANALYSIS_MAX_SCENARIOS),
  }).strict()).max(ANALYSIS_MAX_ARRAY_ITEMS),
  disclaimer: textString,
}).strict();

export type AggregateAnalysisInput = z.infer<typeof AggregateAnalysisInputSchema>;
type ParsedAggregateAnalysisResult = z.infer<typeof AggregateAnalysisResultSchema>;
export type AggregateAnalysisResult = Omit<ParsedAggregateAnalysisResult, 'scenarios'> & {
  scenarios: AggregateScenario[];
};

export interface ModelClient {
  generateEmployeeAnalysis(input: EmployeeAnalysisInput): Promise<EmployeeAnalysisResult>;
  generatePositionAnalysis(input: PositionAnalysisInput): Promise<PositionAnalysisResult>;
  generateAggregateAnalysis(input: AggregateAnalysisInput): Promise<AggregateAnalysisResult>;
}

export interface DashboardMetric {
  label: string;
  value: number;
}

export interface DashboardBreakdownItem {
  label: string;
  count: number;
}

export interface DashboardHeatmapCell {
  row: string;
  column: string;
  count: number;
}

export interface DashboardDimensionStat {
  dimensionKey: 'ai_suitability' | 'task_preparation' | 'iteration_adjustment' | 'result_verification' | 'workflow_integration' | 'method_reuse';
  dimension: string;
  description: string;
  average: number | null;
  validSampleCount: number;
}

export interface DashboardPositionDemandMatrix {
  positions: Array<{ position: string; validSampleCount: number }>;
  scenarios: Array<{ scenarioId: string; title: string; capabilityTheme: string }>;
  cells: Array<{
    position: string;
    scenarioId: string;
    mentions: number;
    validSampleCount: number;
  }>;
}

export interface DashboardAiUsageStats {
  validSampleCount: number;
  statuses: DashboardBreakdownItem[];
  tools: DashboardBreakdownItem[];
  scenarios: DashboardBreakdownItem[];
  nonUseReasons: DashboardBreakdownItem[];
  barriers: DashboardBreakdownItem[];
}

export interface AdminDashboardDto {
  batch: { id: string; name: string };
  aggregateStatus: AggregateStatus;
  sampleSufficient: boolean;
  minSampleSize: number;
  validAnalysisSourceCount: number;
  metrics: DashboardMetric[];
  analysisStatuses: DashboardBreakdownItem[];
  departmentCoverage: DashboardBreakdownItem[];
  positionCoverage: DashboardBreakdownItem[];
  heatmap: DashboardHeatmapCell[];
  dimensions: DashboardDimensionStat[];
  positionDemandMatrix: DashboardPositionDemandMatrix;
  aiUsageStats: DashboardAiUsageStats;
  scenarios: AggregateScenario[];
  lastCalculatedAt?: string;
  errorSummary?: string;
}
