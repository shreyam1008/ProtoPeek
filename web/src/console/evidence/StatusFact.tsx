import type { ReactNode } from 'react';

type StatusFactProps = {
  label: ReactNode;
  value: ReactNode;
  className?: string;
};

export function StatusFact({ label, value, className }: StatusFactProps) {
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
