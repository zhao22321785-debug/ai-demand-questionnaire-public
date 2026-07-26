import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StepLayout } from '../../src/components/form/StepLayout';

it('renders question actions inside the question section instead of the page footer', () => {
  const { container } = render(
    <MemoryRouter>
      <StepLayout module="员工需求调研" progress="1 / 6" title="测试题" actions={<button>下一题</button>}>
        <div>题目内容</div>
      </StepLayout>
    </MemoryRouter>,
  );
  expect(container.querySelector('.question-step .question-step__actions')).toContainElement(
    screen.getByRole('button', { name: '下一题' }),
  );
  expect(container.querySelector('.survey-page__footer')).not.toBeInTheDocument();
});
