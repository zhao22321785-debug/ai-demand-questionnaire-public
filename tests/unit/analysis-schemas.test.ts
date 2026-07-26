import { EmployeeAnalysisResultSchema } from '../../src/types/analysis';
import { employeeResultJsonSchema } from '../../netlify/functions/_shared/analysis-schemas';

it('rejects invented scenarios when the employee submitted no explicit demand', () => {
  const parsed = EmployeeAnalysisResultSchema.safeParse({
    kind: 'employee', subjectId: 'response-1', revision: 1, hasExplicitDemand: false,
    summary: '没有明确需求', departments: ['技术研发'], positions: ['研发工程师'], aiUseBackground: ['尚未使用'], behaviorProfile: ['仅记录行为'], dimensionNotes: ['已记录'],
    disclaimer: '初步分析',
    scenarios: [{
      id: 'invented', title: '虚构需求', audience: 'self', taskSummary: '虚构', currentProcess: '虚构', mainProblem: '虚构',
      occurrence: 'unknown', stability: 'unknown', originalExpectation: '虚构', supportForms: [], attentionReason: '虚构', completeness: 'insufficient',
      missingInformation: [], followUpQuestions: [], evidence: [{ subjectType: 'employee_assessment', subjectId: 'response-1', revision: 1, fieldPath: 'tasks.fake', label: '来源' }],
    }],
  });
  expect(parsed.success).toBe(false);
});

it('rejects oversized model strings and scenario collections at the Zod boundary', () => {
  const base = {
    kind: 'employee', subjectId: 'response-1', revision: 1, hasExplicitDemand: true,
    summary: 'a'.repeat(4_001), departments: ['技术研发'], positions: ['研发工程师'], aiUseBackground: [], behaviorProfile: [], dimensionNotes: [],
    disclaimer: '初步分析', scenarios: [],
  };
  expect(EmployeeAnalysisResultSchema.safeParse(base).success).toBe(false);
  expect(EmployeeAnalysisResultSchema.safeParse({ ...base, summary: '正常', scenarios: Array.from({ length: 21 }, (_, index) => ({
    id: `scenario-${index}`, title: '标题', audience: '本人', taskSummary: '任务', currentProcess: '当前', mainProblem: '问题',
    occurrence: '每周', stability: '稳定', originalExpectation: '期望', supportForms: [], attentionReason: '原因', completeness: 'complete',
    missingInformation: [], followUpQuestions: [], evidence: [{ subjectType: 'employee_assessment', subjectId: 'response-1', revision: 1, fieldPath: 'aiUseStatus', label: '来源' }],
  })) }).success).toBe(false);
});

it('mirrors maximum string and array bounds in the Responses JSON Schema', () => {
  expect(employeeResultJsonSchema.properties.summary).toMatchObject({ maxLength: 4000 });
  expect(employeeResultJsonSchema.properties.scenarios).toMatchObject({ maxItems: 20 });
});
