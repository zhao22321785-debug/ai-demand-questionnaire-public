import type { PropsWithChildren, ReactNode } from 'react';
import { Brand } from './Brand';

interface AuthLayoutProps extends PropsWithChildren {
  title: string;
  description: string;
  footer?: ReactNode;
}

export function AuthLayout({ title, description, footer, children }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <header className="auth-page__brand"><Brand /></header>
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow">内部调研工具</p>
        <h1 id="auth-title">{title}</h1>
        <p className="auth-panel__description">{description}</p>
        {children}
      </section>
      <footer className="auth-page__footer">{footer ?? '账号仅用于识别答卷归属，请勿填写敏感信息。'}</footer>
    </main>
  );
}
