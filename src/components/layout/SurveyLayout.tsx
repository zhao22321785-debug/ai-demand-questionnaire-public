import type { PropsWithChildren, ReactNode } from 'react';
import { Brand } from './Brand';

interface SurveyLayoutProps extends PropsWithChildren {
  module: string;
  progress?: string;
  footer?: ReactNode;
}

export function SurveyLayout({ module, progress, footer, children }: SurveyLayoutProps) {
  return (
    <main className="survey-page">
      <header className="survey-page__header">
        <Brand />
        <div className="survey-page__meta">
          <span>{module}</span>
          {progress ? <span>{progress}</span> : null}
        </div>
      </header>
      <div className="survey-page__content">{children}</div>
      {footer ? <footer className="survey-page__footer">{footer}</footer> : null}
    </main>
  );
}
