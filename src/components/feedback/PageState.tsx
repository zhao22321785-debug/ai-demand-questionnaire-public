import type { ReactNode } from 'react';

type PageStateTone = 'neutral' | 'success' | 'warning' | 'danger';

interface PageStateProps {
  title: string;
  description?: string;
  tone?: PageStateTone;
  action?: ReactNode;
}

export function PageState({ title, description, tone = 'neutral', action }: PageStateProps) {
  return (
    <section className={`page-state page-state--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="page-state__marker" aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {action ? <div className="page-state__action">{action}</div> : null}
      </div>
    </section>
  );
}
