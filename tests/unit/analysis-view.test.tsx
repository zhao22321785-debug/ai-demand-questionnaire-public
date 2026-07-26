import { fireEvent, render, screen } from '@testing-library/react';
import { EmployeeAnalysisView } from '../../src/features/analysis/EmployeeAnalysisView';
import { AnalysisState } from '../../src/features/analysis/AnalysisState';
import type { EmployeeAnalysisResult } from '../../src/types/analysis';

const employeeAnalysisFixture: EmployeeAnalysisResult = {
  kind: 'employee',
  subjectId: 'employee-1',
  revision: 1,
  hasExplicitDemand: true,
  summary: '整理项目周报时，需要减少重复汇总。',
  departments: ['技术研发'],
  positions: ['研发工程师'],
  aiUseBackground: ['偶尔使用 AI 整理初稿。'],
  behaviorProfile: ['会先核对来源再采用输出。'],
  dimensionNotes: ['行为回顾仅用于理解当前做法。'],
  disclaimer: '这是初步分析线索，不代表立项、优先级或技术可行性。',
  scenarios: [{
    id: 'scenario-1',
    title: '项目周报整理',
    audience: '项目成员',
    taskSummary: '汇总项目进展并形成周报。',
    currentProcess: '从多个文档复制进展后人工整理。',
    mainProblem: '重复整理耗时，容易遗漏。',
    occurrence: '每周发生',
    stability: '部分步骤固定',
    originalExpectation: '希望先生成可核对的周报初稿。',
    supportForms: ['汇总', '初稿生成'],
    attentionReason: '有明确任务、问题和期望。',
    completeness: 'complete',
    missingInformation: [],
    followUpQuestions: [],
    evidence: [{
      subjectType: 'employee_assessment',
      subjectId: 'employee-1',
      revision: 1,
      fieldPath: 'tasks.0.currentProcess',
      taskId: 'task-1',
      label: '任务 1：当前做法',
    }],
  }],
};

it('opens the source answer for every main conclusion', () => {
  const onOpenEvidence = vi.fn();
  render(<EmployeeAnalysisView result={employeeAnalysisFixture} onOpenEvidence={onOpenEvidence} />);

  const links = screen.getAllByRole('link', { name: '查看原始回答' });
  expect(links).toHaveLength(
    employeeAnalysisFixture.scenarios.length,
  );
  fireEvent.click(links[0]);
  expect(onOpenEvidence).toHaveBeenCalledWith(employeeAnalysisFixture.scenarios[0].evidence[0]);
});

it('keeps the employee view to background and behavior review when there is no explicit demand', () => {
  render(<EmployeeAnalysisView result={{ ...employeeAnalysisFixture, hasExplicitDemand: false, scenarios: [] }} />);

  expect(screen.getByText('本次没有明确需求')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '具体需求场景' })).not.toBeInTheDocument();
});

it.each([
  ['queued', '分析准备中'],
  ['running', '正在分析'],
  ['stale', '分析需要更新'],
])('shows the %s analysis state without presenting a result as current', (status, title) => {
  render(<AnalysisState analysis={{
    id: 'analysis-1', subjectType: 'employee_assessment', subjectId: 'employee-1', revision: 1,
    status: status as 'queued' | 'running' | 'stale', result: null, attemptCount: 0,
    promptVersion: 'v1', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z',
  }} />);

  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
});

it('shows the analysis failure summary while keeping the original response available', () => {
  render(<AnalysisState analysis={{
    id: 'analysis-1', subjectType: 'employee_assessment', subjectId: 'employee-1', revision: 1,
    status: 'failed', result: null, attemptCount: 3, errorSummary: '模型服务暂时不可用',
    promptVersion: 'v1', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z',
  }} />);

  expect(screen.getByRole('alert')).toHaveTextContent('模型服务暂时不可用');
  expect(screen.getByRole('alert')).toHaveTextContent('原始答卷仍可查看和修改。');
});
