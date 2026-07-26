import { render, screen } from '@testing-library/react';
import { App } from '../../src/app/App';

it('renders the survey login shell', async () => {
  window.history.pushState({}, '', '/survey/login');
  render(<App />);
  expect(await screen.findByRole('heading', { name: '继续填写需求调研' })).toBeInTheDocument();
  expect(screen.queryByText('管理员登录')).not.toBeInTheDocument();
});
