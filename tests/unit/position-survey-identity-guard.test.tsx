import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DataClientProvider } from '../../src/lib/data/DataClientProvider';
import type { SurveyDataClient } from '../../src/lib/data/contracts';
import { PositionSurveyPage } from '../../src/features/position-survey/PositionSurveyPage';
import type { PositionResponseRecord, ReferenceData } from '../../src/types/survey';

const reference: ReferenceData = {
  activeBatch: {
    id: 'batch-current',
    name: '当前批次',
    surveyVersionId: 'survey-current',
    employeeSurveyVersionId: 'employee-current',
    positionSurveyVersionId: 'position-current',
  },
  departments: [{ id: 'product', code: 'product', label: '产品与运营' }],
  positions: [{ id: 'other', code: 'other', label: '其他' }, { id: 'product-manager', code: 'product_manager', label: '产品经理' }],
  aiTools: [],
};

function recordFor(batchId: string): PositionResponseRecord {
  return {
    id: 'position-response-1',
    userId: 'user-1',
    batchId,
    type: 'position',
    positionKey: 'other:业务运营协调',
    revision: 1,
    analysisStatus: 'complete',
    submittedAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    input: {
      batchId,
      surveyVersionId: 'position-original',
      researcherName: '岗位负责人',
      departmentId: 'product',
      positionId: 'other',
      positionOther: '业务运营协调',
      positionName: '业务运营协调',
      relatedPositionExperience: '3_5',
      workItems: [
        { id: 'work-1', name: '需求整理', description: '整理来自业务部门的需求。', selectedForImprovement: true },
        { id: 'work-2', name: '进度跟进', description: '持续跟进协作进度。', selectedForImprovement: false },
      ],
      taskDemands: [{
        id: 'task-1', workItemId: 'work-1', task: '归纳需求记录', commonInput: '访谈记录', hasFixedInput: true,
        output: '需求清单', hasFixedOutput: true, currentProcess: '人工归类', mainProblem: '容易遗漏来源',
        occurrence: 'weekly', stability: 'partly_fixed', audience: 'same_position', aiParticipation: 'assist',
        expectedAiSupport: '辅助归类并保留来源', resultUsage: 'human_review', humanReviewContent: '由负责人确认结论',
        requiresCollaboration: false, collaborationDepartments: [], collaborationPositions: [],
      }],
    },
  };
}

function clientFor(record: PositionResponseRecord | null, savePositionSurvey = vi.fn()): SurveyDataClient {
  return {
    getReferenceData: async () => reference,
    getPositionResponse: async () => record,
    savePositionSurvey,
  } as unknown as SurveyDataClient;
}

function renderPage(client: SurveyDataClient, path = '/survey/position?edit=position-response-1') {
  return render(
    <DataClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <PositionSurveyPage />
      </MemoryRouter>
    </DataClientProvider>,
  );
}

it('阻断历史批次岗位答卷修改，且不会发起保存', async () => {
  const savePositionSurvey = vi.fn();
  renderPage(clientFor(recordFor('batch-history'), savePositionSurvey));

  expect(await screen.findByRole('alert')).toHaveTextContent('历史答卷暂不可修改');
  expect(screen.queryByRole('button', { name: '保存答卷' })).not.toBeInTheDocument();
  expect(savePositionSurvey).not.toHaveBeenCalled();
});

it('答卷批次身份为空时失败关闭，且不会发起保存', async () => {
  const savePositionSurvey = vi.fn();
  renderPage(clientFor(recordFor(''), savePositionSurvey));

  expect(await screen.findByRole('alert')).toHaveTextContent('答卷身份无法确认');
  expect(screen.queryByRole('button', { name: '保存答卷' })).not.toBeInTheDocument();
  expect(savePositionSurvey).not.toHaveBeenCalled();
});

it('当前批次编辑锁定岗位身份字段，并以原身份保存修订', async () => {
  const user = userEvent.setup();
  const savePositionSurvey = vi.fn().mockResolvedValue({ id: 'position-response-1', revision: 2, analysisStatus: 'pending' });
  renderPage(clientFor(recordFor('batch-current'), savePositionSurvey));

  await screen.findByRole('heading', { name: '确认调研岗位' });
  expect(screen.getByLabelText('调研岗位名称')).toBeDisabled();
  expect(screen.getByLabelText('岗位类别')).toBeDisabled();
  expect(screen.getByLabelText('其他岗位类别')).toBeDisabled();
  expect(screen.getByLabelText('调研岗位名称')).toHaveValue('业务运营协调');
  expect(screen.getByLabelText('其他岗位类别')).toHaveValue('业务运营协调');

  await user.click(screen.getByRole('button', { name: '下一项' }));
  await user.click(screen.getByRole('button', { name: '下一项' }));
  await user.click(screen.getByRole('button', { name: '下一项' }));
  await user.click(screen.getByRole('button', { name: '保存答卷' }));

  await waitFor(() => expect(savePositionSurvey).toHaveBeenCalledTimes(1));
  expect(savePositionSurvey).toHaveBeenCalledWith(expect.objectContaining({
    batchId: 'batch-current',
    positionId: 'other',
    positionName: '业务运营协调',
    positionOther: '业务运营协调',
  }));
});

it('编辑态身份控件被程序化篡改后仍使用加载时的原身份快照', async () => {
  const user = userEvent.setup();
  const savePositionSurvey = vi.fn().mockResolvedValue({ id: 'position-response-1', revision: 2, analysisStatus: 'pending' });
  renderPage(clientFor(recordFor('batch-current'), savePositionSurvey));

  await screen.findByRole('heading', { name: '确认调研岗位' });
  const positionName = screen.getByLabelText('调研岗位名称');
  const positionOther = screen.getByLabelText('其他岗位类别');
  const positionId = screen.getByLabelText('岗位类别');
  positionName.removeAttribute('disabled');
  positionOther.removeAttribute('disabled');
  positionId.removeAttribute('disabled');
  await user.clear(positionName);
  await user.type(positionName, '被篡改的岗位名称');
  await user.clear(positionOther);
  await user.type(positionOther, '被篡改的其他类别');
  await user.selectOptions(positionId, 'product-manager');

  await user.click(screen.getByRole('button', { name: '下一项' }));
  await user.click(screen.getByRole('button', { name: '下一项' }));
  await user.click(screen.getByRole('button', { name: '下一项' }));
  await user.click(screen.getByRole('button', { name: '保存答卷' }));

  await waitFor(() => expect(savePositionSurvey).toHaveBeenCalledTimes(1));
  expect(savePositionSurvey).toHaveBeenCalledWith(expect.objectContaining({
    batchId: 'batch-current',
    positionId: 'other',
    positionName: '业务运营协调',
    positionOther: '业务运营协调',
  }));
});

it('新建岗位答卷仍可填写岗位身份字段', async () => {
  const user = userEvent.setup();
  renderPage(clientFor(null), '/survey/position');

  await screen.findByRole('heading', { name: '确认调研岗位' });
  expect(screen.getByLabelText('调研岗位名称')).not.toBeDisabled();
  expect(screen.getByLabelText('岗位类别')).not.toBeDisabled();
  await user.selectOptions(screen.getByLabelText('岗位类别'), 'other');
  expect(screen.getByLabelText('其他岗位类别')).not.toBeDisabled();
  await user.type(screen.getByLabelText('调研岗位名称'), '新岗位');
  await user.type(screen.getByLabelText('其他岗位类别'), '新岗位类别');
  expect(screen.getByLabelText('调研岗位名称')).toHaveValue('新岗位');
  expect(screen.getByLabelText('其他岗位类别')).toHaveValue('新岗位类别');
});
