import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DataClientProvider } from '../../src/lib/data/DataClientProvider';
import type { SurveyDataClient } from '../../src/lib/data/contracts';
import { AdminOverviewPage, DemandWorkbenchPage, DifferencesPage } from '../../src/features/admin';
import { adminDashboardFixture, insufficientDashboardFixture } from '../fixtures/admin-analysis';

function clientFor(dashboard = adminDashboardFixture): SurveyDataClient {
  return { getAdminDashboard: async () => dashboard } as SurveyDataClient;
}
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function renderPage(page: ReactNode, initialEntry = '/') {
  return render(<DataClientProvider client={clientFor()}><MemoryRouter initialEntries={[initialEntry]}>{page}<Location /></MemoryRouter></DataClientProvider>);
}

it('D1 重点概览只展示三项关键数字、三条以内重点发现和证据结构', async () => {
  const { container } = renderPage(<AdminOverviewPage />);
  expect(await screen.findByRole('heading', { name: '重点发现' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '数据总览' })).toBeInTheDocument();
  expect(container.querySelectorAll('.admin-metric')).toHaveLength(3);
  expect(container.querySelectorAll('.admin-finding-list > li').length).toBeLessThanOrEqual(3);
  expect(screen.getByRole('heading', { name: '需求证据结构' })).toBeInTheDocument();
  expect(screen.queryByText(/优先级总分|岗位排名|立项建议/)).not.toBeInTheDocument();
});

it('D1 将明确不同计入双方均有证据，四类合计始终等于需求总数', async () => {
  const conflictDashboard = {
    ...adminDashboardFixture,
    scenarios: adminDashboardFixture.scenarios.map((scenario, index) => index === 0 ? { ...scenario, evidenceStatus: 'explicit_conflict' as const } : scenario),
  };
  render(<DataClientProvider client={clientFor(conflictDashboard)}><MemoryRouter><AdminOverviewPage /></MemoryRouter></DataClientProvider>);
  const categories = await screen.findByRole('list', { name: '需求证据结构分类' });
  const sum = within(categories).getAllByRole('listitem').reduce((total, item) => total + Number(item.querySelector('b')?.textContent ?? 0), 0);
  expect(sum).toBe(conflictDashboard.scenarios.length);
  expect(within(categories).getByText('双方均有证据').closest('li')?.querySelector('b')).toHaveTextContent('1');
});

it('D1 需求分布区分 0/n 和无样本，并声明颜色不表示优先级', async () => {
  const user = userEvent.setup();
  renderPage(<AdminOverviewPage />);
  await user.click(await screen.findByRole('tab', { name: '需求分布' }));
  const composition = screen.getByRole('list', { name: '需求来源构成' });
  expect(within(composition).getByRole('button', { name: /整理访谈与需求记录/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByText('双方均有证据').length).toBeGreaterThan(0);
  await user.click(within(composition).getByRole('button', { name: /生成客户沟通摘要/ }));
  expect(within(composition).getByText('仅员工侧有证据')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '按岗位看' }));
  const matrix = screen.getByRole('table', { name: '岗位需求提及矩阵' });
  expect(within(matrix).getAllByText('0/3').length).toBeGreaterThan(0);
  expect(within(matrix).getAllByText('—').length).toBeGreaterThan(0);
  expect(screen.getByText(/颜色不表示优先级/)).toBeInTheDocument();
  expect(screen.getAllByText(/有样本，未提及/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/无样本/).length).toBeGreaterThan(0);
});

it('D1 AI 使用现状展示固定统计、员工画像和有效样本，不生成总分或缺失维度轮廓', async () => {
  const user = userEvent.setup();
  const { container } = renderPage(<AdminOverviewPage />);
  await user.click(await screen.findByRole('tab', { name: 'AI 使用现状' }));
  expect(screen.getByRole('heading', { name: 'AI 使用情况' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '员工画像' })).toBeInTheDocument();
  expect(screen.getByText('总体样本 6 份')).toBeInTheDocument();
  expect(screen.getByText('固定顺序 · 无总分 · 无排名')).toBeInTheDocument();
  expect(screen.getByText('AI 适用场景判断')).toBeInTheDocument();
  expect(screen.getByText('方法沉淀与协作复用')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '员工画像六维雷达图' })).toBeInTheDocument();
  expect(container.querySelector('.admin-radar__value')).not.toBeInTheDocument();
  expect(screen.getByText(/缺失维度不按 0 分/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'AI 使用状态构成' })).toBeInTheDocument();
});

it('D1 六维统计按稳定键匹配，不依赖远程数组顺序', async () => {
  const user = userEvent.setup();
  const dashboard = {
    ...adminDashboardFixture,
    dimensions: [
      { dimensionKey: 'method_reuse' as const, dimension: '旧名称 6', description: '旧说明 6', average: 1, validSampleCount: 2 },
      { dimensionKey: 'ai_suitability' as const, dimension: '旧名称 1', description: '旧说明 1', average: 5, validSampleCount: 6 },
    ],
  };
  render(<DataClientProvider client={clientFor(dashboard)}><MemoryRouter><AdminOverviewPage /></MemoryRouter></DataClientProvider>);
  await user.click(await screen.findByRole('tab', { name: 'AI 使用现状' }));
  expect(within(screen.getByText('AI 适用场景判断').closest('article') as HTMLElement).getByText('5.0')).toBeInTheDocument();
  expect(within(screen.getByText('方法沉淀与协作复用').closest('article') as HTMLElement).getByText('1.0')).toBeInTheDocument();
});

it('D2 首屏突出 Agent 初步分析、事实信号和五步路径', async () => {
  const { container } = renderPage(<DemandWorkbenchPage />, '/admin/demands?selected=scenario-knowledge');
  expect(await screen.findByRole('heading', { name: '整理访谈与需求记录' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Agent 初步分析' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '需求事实信号' })).toBeInTheDocument();
  expect(container.querySelectorAll('.admin-analysis-path li')).toHaveLength(5);
  expect(screen.getByText('建设前提')).toBeInTheDocument();
  expect(screen.getByText(/不代表立项、审批、优先级/)).toBeInTheDocument();
  expect(screen.getByText(/当前做法主要是/)).toBeInTheDocument();
  expect(screen.getByText(/不能形成建设结论/)).toBeInTheDocument();
});

it('D2 直接进入工作台时默认选择首条需求并同步 selected', async () => {
  renderPage(<DemandWorkbenchPage />, '/admin/demands');
  expect(await screen.findByRole('heading', { name: '整理访谈与需求记录' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('selected=scenario-knowledge'));
});

it('D2 筛选清单并同步 selected 和页内标签到 URL', async () => {
  const user = userEvent.setup();
  renderPage(<DemandWorkbenchPage />, '/admin/demands');
  await screen.findByRole('heading', { name: '具体需求' });
  await user.type(screen.getByRole('searchbox', { name: '搜索需求' }), '客户沟通');
  expect(screen.getByRole('button', { name: /生成客户沟通摘要/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /整理访谈与需求记录/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /生成客户沟通摘要/ }));
  expect(screen.getByTestId('location')).toHaveTextContent('selected=scenario-brief');
  await user.click(screen.getByRole('tab', { name: '来源证据' }));
  expect(screen.getByTestId('location')).toHaveTextContent('tab=evidence');
  expect(screen.getByRole('link', { name: /进入证据对比/ })).toHaveAttribute('href', '/admin/differences?selected=scenario-brief');
});

it('D2 原始答卷可以追溯到具体员工和负责人答卷', async () => {
  const user = userEvent.setup();
  renderPage(<DemandWorkbenchPage />, '/admin/demands?selected=scenario-knowledge');
  await user.click(await screen.findByRole('tab', { name: '原始答卷' }));
  expect(screen.getAllByRole('link', { name: /员工答卷/ }).find((link) => link.getAttribute('href')?.endsWith('/employee-1'))).toHaveAttribute('href', '/admin/employee-responses/employee-1');
  expect(screen.getAllByRole('link', { name: /负责人答卷/ }).find((link) => link.getAttribute('href')?.endsWith('/position-1'))).toHaveAttribute('href', '/admin/position-responses/position-1');
});

it('D3 展示批次状态、五维镜像覆盖和逐维内容矩阵', async () => {
  const { container } = renderPage(<DifferencesPage />, '/admin/differences?selected=scenario-knowledge');
  expect(await screen.findByRole('heading', { name: '证据对比' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '批次证据状态' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '五维证据覆盖镜像图' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '证据比较完整度' })).toBeInTheDocument();
  expect(screen.getByText('降级原因')).toBeInTheDocument();
  expect(screen.getByText('缺失维度')).toBeInTheDocument();
  expect(container.querySelectorAll('.admin-mirror-panel article')).toHaveLength(5);
  expect(screen.getAllByText('实际工作场景').length).toBeGreaterThan(0);
  expect(screen.getAllByText('系统与数据条件').length).toBeGreaterThan(0);
  expect(screen.getAllByText('1/1').length).toBeGreaterThan(0);
  expect(screen.getByText(/0\/n 是有样本但未提及/)).toBeInTheDocument();
});

it('D3 将未提及显示为证据缺失而非冲突，并可进入 D2 与来源答卷', async () => {
  const user = userEvent.setup();
  renderPage(<DifferencesPage />, '/admin/differences?selected=scenario-knowledge');
  expect(await screen.findAllByText('员工侧未提及')).not.toHaveLength(0);
  expect(screen.getAllByText(/未提及表示证据缺失，不表示意见冲突/).length).toBeGreaterThan(0);
  expect(screen.queryByText('双方明确观点不同')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '进入需求分析 →' })).toHaveAttribute('href', '/admin/demands?selected=scenario-knowledge');
  await user.click(screen.getAllByText('查看本维度来源答卷')[0]);
  expect(screen.getAllByRole('link', { name: /查看来源/ }).length).toBeGreaterThan(0);
});

it('D3 来源失效时隐藏旧摘要并重算当前来源覆盖', async () => {
  const scenario = adminDashboardFixture.scenarios[0];
  const unavailable = {
    ...scenario,
    evidenceDimensions: scenario.evidenceDimensions?.map((item, index) => index === 0 ? {
      ...item,
      employeeSourceIds: [...item.employeeSourceIds, 'missing-source'],
      employeeSourceCount: item.employeeSourceCount + 1,
      employeeSummary: '不应继续展示的旧摘要',
    } : item),
  };
  const dashboard = { ...adminDashboardFixture, scenarios: [unavailable] };
  render(<DataClientProvider client={clientFor(dashboard)}><MemoryRouter initialEntries={['/admin/differences']}><DifferencesPage /></MemoryRouter></DataClientProvider>);
  expect(await screen.findByRole('heading', { name: '部分来源当前不可用' })).toBeInTheDocument();
  expect(screen.queryByText('不应继续展示的旧摘要')).not.toBeInTheDocument();
  expect(screen.queryByText(scenario.summary)).not.toBeInTheDocument();
  expect(screen.getByText('部分来源已更新，原聚合摘要已隐藏，等待重新分析。')).toBeInTheDocument();
  expect(screen.getByText(/原员工侧摘要不再作为当前结论展示/)).toBeInTheDocument();
  const selectedButton = screen.getByRole('button', { name: new RegExp(scenario.title) });
  expect(within(selectedButton).getByText('证据待重算')).toBeInTheDocument();
  const detailHeader = screen.getByRole('heading', { name: scenario.title }).closest('header') as HTMLElement;
  expect(within(detailHeader).getByText('证据待重算')).toBeInTheDocument();
});

it('聚合失败或过期时不展示旧 Agent 场景，固定统计仍可访问', async () => {
  const failed = { ...adminDashboardFixture, aggregateStatus: 'failed' as const, errorSummary: '聚合服务暂时不可用' };
  const overview = render(<DataClientProvider client={clientFor(failed)}><MemoryRouter><AdminOverviewPage /></MemoryRouter></DataClientProvider>);
  expect(await screen.findByRole('heading', { name: '聚合分析暂时失败' })).toBeInTheDocument();
  expect(screen.getByText('有效答卷')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /整理访谈与需求记录/ })).not.toBeInTheDocument();
  overview.unmount();

  const stale = { ...adminDashboardFixture, aggregateStatus: 'stale' as const };
  render(<DataClientProvider client={clientFor(stale)}><MemoryRouter><DemandWorkbenchPage /></MemoryRouter></DataClientProvider>);
  expect(await screen.findByRole('heading', { name: '分析已过期，正在重新计算' })).toBeInTheDocument();
  expect(screen.queryByText('AGENT 初步分析')).not.toBeInTheDocument();
});

it('小样本只保留来源入口，不形成岗位共性或冲突结论', async () => {
  render(<DataClientProvider client={clientFor(insufficientDashboardFixture)}><MemoryRouter initialEntries={['/admin/differences']}><DifferencesPage /></MemoryRouter></DataClientProvider>);
  expect(await screen.findByRole('heading', { name: '样本不足，暂不形成共性结论' })).toBeInTheDocument();
  expect(screen.getByText(/展示岗位共性、部门比较或趋势/)).toBeInTheDocument();
  expect(screen.getAllByText('样本不足').length).toBeGreaterThan(0);
  expect(screen.queryByText('双方明确观点不同')).not.toBeInTheDocument();
});
