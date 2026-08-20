import type { KeyboardEvent, ReactNode } from 'react';

import { classNames } from '@/shared/runtime';

export type TabOption<T extends string> = {
  value: T;
  label: ReactNode;
};

export function AccessibleTabs<T extends string>({
  id,
  label,
  tabs,
  value,
  onChange,
  className,
}: {
  id: string;
  label: string;
  tabs: Array<TabOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex((tab) => tab.value === value);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return;
    onChange(next.value);
    requestAnimationFrame(() => {
      const nextTab = document.getElementById(`${id}-tab-${next.value}`);
      nextTab?.focus();
      nextTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  }

  return (
    <div
      className={classNames('pp-pane-tabs', className)}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => (
        <button
          id={`${id}-tab-${tab.value}`}
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={`${id}-panel-${tab.value}`}
          tabIndex={value === tab.value ? 0 : -1}
          className={classNames('pp-pane-tab', value === tab.value && 'pp-pane-tab-active')}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  id,
  tab,
  children,
  className,
  active = true,
}: {
  id: string;
  tab: string;
  children: ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <div
      id={`${id}-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`${id}-tab-${tab}`}
      className={className}
      hidden={!active}
    >
      {children}
    </div>
  );
}
