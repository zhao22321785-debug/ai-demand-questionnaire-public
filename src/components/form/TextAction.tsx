import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type TextActionProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> & { direction?: 'forward' | 'back' };

export function TextAction({ children, direction = 'forward', className = '', ...props }: TextActionProps) {
  return (
    <button className={`text-action ${className}`.trim()} type="button" {...props}>
      {direction === 'back' ? <span aria-hidden="true">←</span> : null}
      <span>{children}</span>
      {direction === 'forward' ? <span aria-hidden="true">→</span> : null}
    </button>
  );
}
