import type { PropsWithChildren, ReactNode } from 'react';
import { SurveyLayout } from '../layout/SurveyLayout';

interface StepLayoutProps extends PropsWithChildren {
  module: string;
  progress: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function StepLayout({ module, progress, title, description, actions, children }: StepLayoutProps) {
  return (
    <SurveyLayout module={module} progress={progress}>
      <section className="question-step" aria-labelledby="question-title">
        <h1 id="question-title">{title}</h1>
        {description ? <p className="question-step__description">{description}</p> : null}
        <div className="question-step__body">{children}</div>
        {actions ? <div className="question-step__actions">{actions}</div> : null}
      </section>
    </SurveyLayout>
  );
}
