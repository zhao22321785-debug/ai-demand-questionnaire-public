import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { EmployeeSurveyPage } from '../../src/features/employee-survey/EmployeeSurveyPage';
import { DataClientProvider } from '../../src/lib/data/DataClientProvider';
import type { SurveyDataClient } from '../../src/lib/data/contracts';
import type { ReferenceData, UserProfileInput } from '../../src/types/survey';

const completeProfile: UserProfileInput = {
  name: '测试员工',
  departmentId: 'product',
  positionId: 'pm',
  currentPositionExperience: '1_3',
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

function renderSurvey({ profile, saveEmployeeSurvey = vi.fn() }: {
  profile: UserProfileInput | null;
  saveEmployeeSurvey?: ReturnType<typeof vi.fn>;
}): void {
  const client = {
    getProfile: vi.fn().mockResolvedValue(profile),
    getReferenceData: vi.fn().mockResolvedValue(referenceData),
    saveEmployeeSurvey,
  } as unknown as SurveyDataClient;

  render(
    <DataClientProvider client={client}>
      <MemoryRouter initialEntries={['/survey/employee']}>
        <EmployeeSurveyPage />
      </MemoryRouter>
    </DataClientProvider>,
  );
}

async function completeNoDemandSurvey(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('还没有使用过'));
  await user.click(screen.getByRole('button', { name: '下一题' }));
  await user.click(screen.getByLabelText('没有时间或机会尝试'));
  await user.click(screen.getByRole('button', { name: '下一题' }));
  await user.click(screen.getByRole('button', { name: '下一题' }));
  await user.click(screen.getByRole('radio', { name: /暂时没有明确想改善的工作/ }));
  await user.click(screen.getByRole('button', { name: '下一题' }));
  await user.click(screen.getByLabelText('遇到重复、耗时或需要整理信息的工作时，会判断 AI 能否提供帮助。'));
  await user.click(screen.getByRole('button', { name: '保存答卷' }));
}

it('starts with the AI usage question and does not repeat profile inputs', async () => {
  renderSurvey({ profile: completeProfile });

  expect(await screen.findByRole('heading', { name: '您目前在工作中使用 AI 的情况是？' })).toBeInTheDocument();
  expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
});

it('blocks an employee survey when the saved profile is incomplete', async () => {
  renderSurvey({ profile: null });

  expect(await screen.findByRole('heading', { name: '请先补充基本资料' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '补充基本资料' })).toHaveAttribute(
    'href',
    '/survey/profile?returnTo=%2Fsurvey%2Femployee',
  );
});

it('uses the saved profile as the response snapshot', async () => {
  const saveEmployeeSurvey = vi.fn().mockResolvedValue({ id: crypto.randomUUID(), revision: 1, analysisStatus: 'pending' });
  renderSurvey({ profile: completeProfile, saveEmployeeSurvey });

  await screen.findByRole('heading', { name: '您目前在工作中使用 AI 的情况是？' });
  await completeNoDemandSurvey();

  expect(saveEmployeeSurvey).toHaveBeenCalledWith(expect.objectContaining({ profile: completeProfile }));
});
