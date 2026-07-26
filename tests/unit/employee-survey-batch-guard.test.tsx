import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { DataClientProvider } from '../../src/lib/data/DataClientProvider';
import type { SurveyDataClient } from '../../src/lib/data/contracts';
import { EmployeeSurveyPage } from '../../src/features/employee-survey/EmployeeSurveyPage';
import type { EmployeeResponseRecord, ReferenceData, UserProfileInput } from '../../src/types/survey';

const currentProfile: UserProfileInput = {
  name: '当前资料员工',
  departmentId: 'product',
  positionId: 'pm',
  currentPositionExperience: '3_5',
};

const referenceData: ReferenceData = {
  activeBatch: {
    id: 'batch-current',
    name: '当前调研批次',
    surveyVersionId: 'employee-v2',
    employeeSurveyVersionId: 'employee-v2',
    positionSurveyVersionId: 'position-v2',
  },
  departments: [{ id: 'product', code: 'product', label: '产品' }],
  positions: [{ id: 'pm', code: 'pm', label: '产品经理' }],
  aiTools: [],
};

function employeeRecord(batchId: string): EmployeeResponseRecord {
  return {
    id: 'employee-response-1',
    userId: 'user-1',
    batchId,
    type: 'employee',
    revision: 1,
    analysisStatus: 'complete',
    submittedAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    input: {
      batchId,
      surveyVersionId: 'employee-v1',
      profile: { name: '历史答卷员工', departmentId: 'product', positionId: 'pm', currentPositionExperience: '1_3' },
      aiUseStatus: 'never',
      nonUseReasons: ['没有时间或机会尝试'],
      discontinuationReasons: [],
      aiToolIds: [],
      aiScenarios: [],
      painPoints: [],
      hasExplicitDemand: false,
      tasks: [],
      dimensions: [3, null, null, null, null, null],
    },
  };
}

function renderEditor(record: EmployeeResponseRecord, saveEmployeeSurvey = vi.fn()): ReturnType<typeof render> {
  const client = {
    getProfile: vi.fn().mockResolvedValue(currentProfile),
    getReferenceData: vi.fn().mockResolvedValue(referenceData),
    getEmployeeResponse: vi.fn().mockResolvedValue(record),
    saveEmployeeSurvey,
  } as unknown as SurveyDataClient;

  return render(
    <DataClientProvider client={client}>
      <MemoryRouter initialEntries={['/survey/employee?edit=employee-response-1']}>
        <EmployeeSurveyPage />
      </MemoryRouter>
    </DataClientProvider>,
  );
}

it('阻断历史批次答卷编辑，且不会保存到当前批次', async () => {
  const saveEmployeeSurvey = vi.fn();
  renderEditor(employeeRecord('batch-history'), saveEmployeeSurvey);

  expect(await screen.findByRole('heading', { name: '历史批次答卷无法修改' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存答卷' })).not.toBeInTheDocument();
  expect(saveEmployeeSurvey).not.toHaveBeenCalled();
});

it('允许编辑当前批次答卷并保存到当前批次', async () => {
  const user = userEvent.setup();
  const saveEmployeeSurvey = vi.fn().mockResolvedValue({ id: 'employee-response-1', revision: 2, analysisStatus: 'pending' });
  const historicalRecord = employeeRecord('batch-current');
  renderEditor(historicalRecord, saveEmployeeSurvey);

  await screen.findByRole('button', { name: '下一题' });
  await user.click(screen.getByRole('button', { name: '下一题' }));
  await user.click(screen.getByRole('button', { name: '下一题' }));
  await user.click(screen.getByRole('button', { name: '下一题' }));
  await user.click(screen.getByRole('button', { name: '下一题' }));
  await user.click(screen.getByRole('button', { name: '保存答卷' }));

  expect(saveEmployeeSurvey).toHaveBeenCalledWith(expect.objectContaining({
    batchId: 'batch-current',
    surveyVersionId: 'employee-v2',
    profile: currentProfile,
  }));
  expect(saveEmployeeSurvey).not.toHaveBeenCalledWith(expect.objectContaining({
    profile: historicalRecord.input.profile,
  }));
});
