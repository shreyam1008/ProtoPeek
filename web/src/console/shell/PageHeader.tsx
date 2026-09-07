import type { ComponentProps } from 'react';

/** A single header contract for every workbench. Children retain domain-specific actions. */
export function PageHeader({ className = '', children, ...props }: ComponentProps<'header'>) {
  return (
    <header {...props} className={`pp-page-header ${className}`}>
      {children}
    </header>
  );
}
