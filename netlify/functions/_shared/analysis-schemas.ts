export {
  AggregateAnalysisInputSchema,
  AggregateAnalysisResultSchema,
  EmployeeAnalysisInputSchema,
  EmployeeAnalysisResultSchema,
  EvidenceDimensionComparisonSchema,
  EvidenceReferenceSchema,
  PositionAnalysisInputSchema,
  PositionAnalysisResultSchema,
} from '../../../src/types/analysis';

const limitedString = { type: 'string', minLength: 1, maxLength: 4000 } as const;
const idString = { type: 'string', minLength: 1, maxLength: 200 } as const;
const nullableString = { anyOf: [{ type: 'string', maxLength: 4000 }, { type: 'null' }] } as const;
const stringArray = { type: 'array', maxItems: 20, items: limitedString } as const;
const evidenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subjectType', 'subjectId', 'revision', 'fieldPath', 'taskId', 'label', 'excerpt'],
  properties: {
    subjectType: { type: 'string', enum: ['employee_assessment', 'position_survey'] },
    subjectId: idString,
    revision: { type: 'integer', minimum: 1 },
    fieldPath: { type: 'string', minLength: 1, maxLength: 500 },
    taskId: nullableString,
    label: { type: 'string', minLength: 1, maxLength: 500 },
    excerpt: { anyOf: [{ type: 'string', minLength: 1, maxLength: 2000 }, { type: 'null' }] },
  },
} as const;

const scenarioSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'title', 'audience', 'taskSummary', 'currentProcess', 'mainProblem', 'occurrence', 'stability',
    'originalExpectation', 'supportForms', 'attentionReason', 'completeness', 'missingInformation',
    'followUpQuestions', 'evidence', 'commonInput', 'expectedOutput', 'humanBoundary', 'collaboration', 'capabilityTheme',
  ],
  properties: {
    id: idString, title: limitedString, audience: limitedString, taskSummary: limitedString,
    currentProcess: limitedString, mainProblem: limitedString, occurrence: limitedString, stability: limitedString,
    originalExpectation: limitedString, supportForms: stringArray, attentionReason: limitedString,
    completeness: { type: 'string', enum: ['complete', 'partial', 'insufficient'] },
    missingInformation: stringArray, followUpQuestions: stringArray,
    evidence: { type: 'array', minItems: 1, maxItems: 20, items: evidenceSchema },
    commonInput: nullableString, expectedOutput: nullableString, humanBoundary: nullableString,
    collaboration: nullableString, capabilityTheme: nullableString,
  },
} as const;

export const employeeResultJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'subjectId', 'revision', 'hasExplicitDemand', 'summary', 'departments', 'positions', 'aiUseBackground', 'scenarios', 'behaviorProfile', 'dimensionNotes', 'disclaimer'],
  properties: {
    kind: { type: 'string', const: 'employee' }, subjectId: idString, revision: { type: 'integer', minimum: 1 },
    hasExplicitDemand: { type: 'boolean' }, summary: limitedString, departments: stringArray, positions: stringArray, aiUseBackground: stringArray,
    scenarios: { type: 'array', maxItems: 20, items: scenarioSchema }, behaviorProfile: stringArray, dimensionNotes: stringArray, disclaimer: limitedString,
  },
} as const;

export const positionResultJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'subjectId', 'revision', 'summary', 'departments', 'positions', 'workSummary', 'scenarios', 'capabilityThemes', 'boundariesToAssess', 'disclaimer'],
  properties: {
    kind: { type: 'string', const: 'position' }, subjectId: idString, revision: { type: 'integer', minimum: 1 },
    summary: limitedString, departments: stringArray, positions: stringArray, workSummary: stringArray, scenarios: { type: 'array', maxItems: 20, items: scenarioSchema },
    capabilityThemes: stringArray, boundariesToAssess: stringArray, disclaimer: limitedString,
  },
} as const;

const aggregateSourceSchema = {
  type: 'object', additionalProperties: false,
  required: ['subjectType', 'subjectId', 'revision', 'title', 'route'],
  properties: {
    subjectType: { type: 'string', enum: ['employee_assessment', 'position_survey'] }, subjectId: idString,
    revision: { type: 'integer', minimum: 1 }, title: limitedString, route: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

const evidenceDimensionSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'dimension', 'employeeSourceCount', 'employeeSourceTotal', 'positionSourceCount', 'positionSourceTotal',
    'relation', 'employeeSummary', 'positionSummary', 'employeeSourceIds', 'positionSourceIds',
  ],
  properties: {
    dimension: { type: 'string', enum: ['task_context', 'main_problem', 'expected_support', 'human_boundary', 'system_data_conditions'] },
    // The model is not allowed to infer statistics. These placeholders are overwritten
    // from canonical scenario sources after the response is parsed.
    employeeSourceCount: { const: 0 }, employeeSourceTotal: { const: 0 },
    positionSourceCount: { const: 0 }, positionSourceTotal: { const: 0 },
    relation: {
      type: 'string',
      enum: [
        'both_mentioned', 'complementary', 'direction_aligned', 'employee_supplement', 'position_supplement',
        'employee_missing', 'position_missing', 'both_missing', 'explicit_conflict', 'insufficient_sample',
      ],
    },
    employeeSummary: { type: 'string', maxLength: 4000 },
    positionSummary: { type: 'string', maxLength: 4000 },
    employeeSourceIds: { type: 'array', maxItems: 20, items: idString },
    positionSourceIds: { type: 'array', maxItems: 20, items: idString },
  },
} as const;

export const aggregateResultJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'batchId', 'ruleVersion', 'sampleSize', 'sampleSufficient', 'summary', 'scenarios', 'capabilityThemes', 'disclaimer'],
  properties: {
    kind: { type: 'string', const: 'aggregate' }, batchId: idString, ruleVersion: idString,
    sampleSize: { type: 'integer', minimum: 0 }, sampleSufficient: { type: 'boolean' }, summary: limitedString,
    scenarios: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'title', 'capabilityTheme', 'summary', 'currentProcess', 'mainProblem', 'occurrence', 'stability', 'audience', 'originalExpectations', 'possibleSupport', 'departments', 'positions', 'responseCount', 'coveredPeople', 'employeeEvidence', 'positionEvidence', 'evidenceStatus', 'completeness', 'followUpQuestions', 'sources', 'evidenceDimensions'],
      properties: {
        id: idString, title: limitedString, capabilityTheme: limitedString, summary: limitedString,
        currentProcess: limitedString, mainProblem: limitedString, occurrence: limitedString, stability: limitedString, audience: limitedString,
        originalExpectations: stringArray, possibleSupport: stringArray, departments: stringArray, positions: stringArray,
        responseCount: { type: 'integer', minimum: 0 }, coveredPeople: { type: 'integer', minimum: 0 },
        employeeEvidence: { type: 'array', maxItems: 20, items: evidenceSchema }, positionEvidence: { type: 'array', maxItems: 20, items: evidenceSchema },
        evidenceStatus: { type: 'string', enum: ['both_supported', 'employee_only', 'position_evidence_low', 'explicit_conflict', 'insufficient_sample'] },
        completeness: { type: 'string', enum: ['complete', 'partial', 'insufficient'] }, followUpQuestions: stringArray,
        sources: { type: 'array', minItems: 1, maxItems: 20, items: aggregateSourceSchema },
        evidenceDimensions: { type: 'array', minItems: 5, maxItems: 5, items: evidenceDimensionSchema },
      },
    } },
    capabilityThemes: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false, required: ['id', 'title', 'scenarioIds'],
      properties: { id: idString, title: limitedString, scenarioIds: stringArray },
    } },
    disclaimer: limitedString,
  },
} as const;
