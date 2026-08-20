import {
  BookOpenText,
  Boxes,
  CheckCircle2,
  Download,
  History,
  Network,
  Search,
  Server,
  Settings,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import type { BootstrapService, MethodFilter } from '@/shared/types';
import { classNames } from '@/shared/utils';

export type WorkbenchView =
  | 'compose'
  | 'history'
  | 'tests'
  | 'transport'
  | 'structure'
  | 'workspace';

const utilityViews: Array<{
  key: WorkbenchView;
  icon: typeof History;
  label: string;
}> = [
  { key: 'history', icon: History, label: 'History & saved' },
  { key: 'tests', icon: CheckCircle2, label: 'Checks' },
  { key: 'transport', icon: Network, label: 'Transport' },
  { key: 'structure', icon: BookOpenText, label: 'Schema' },
  { key: 'workspace', icon: Settings, label: 'Targets' },
];

const filters: Array<{ value: MethodFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unary', label: 'Unary' },
  { value: 'server-streaming', label: 'Server' },
  { value: 'client-streaming', label: 'Client' },
  { value: 'bidirectional', label: 'Bidi' },
];

function methodMode(method: BootstrapService['methods'][number]) {
  if (method.clientStreaming && method.serverStreaming) return 'Bidi';
  if (method.clientStreaming) return 'Client';
  if (method.serverStreaming) return 'Server';
  return 'Unary';
}

function ServiceGroup({
  service,
  selectedMethod,
  searching,
  onSelect,
}: {
  service: BootstrapService;
  selectedMethod: string;
  searching: boolean;
  onSelect: (method: string) => void;
}) {
  const selectedInside = service.methods.some((method) => method.fullName === selectedMethod);
  const [open, setOpen] = useState(searching || selectedInside);

  useEffect(() => {
    if (searching || selectedInside) setOpen(true);
  }, [searching, selectedInside]);

  const segments = service.name.split('.');
  const shortName = segments.pop() ?? service.name;
  const packageName = segments.join('.');

  return (
    <section className="pp-service-group">
      <button
        type="button"
        className="pp-service-heading"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Boxes aria-hidden="true" />
        <span>
          <strong>{shortName}</strong>
          {packageName ? <small>{packageName}</small> : null}
        </span>
        <span className="pp-service-count">{service.methods.length}</span>
      </button>
      {open ? (
        <div className="pp-method-list">
          {service.methods.map((method) => (
            <button
              key={method.fullName}
              type="button"
              className={classNames(
                'pp-method-row',
                method.fullName === selectedMethod && 'pp-method-row-active'
              )}
              onClick={() => onSelect(method.fullName)}
            >
              <span>{method.name}</span>
              <small>{methodMode(method)}</small>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function ServiceNavigator({
  services,
  selectedMethod,
  searchText,
  filter,
  activeView,
  historyCount,
  savedCount,
  onSearchChange,
  onFilterChange,
  onSelectMethod,
  onViewChange,
  onExport,
  onImport,
}: {
  services: BootstrapService[];
  selectedMethod: string;
  searchText: string;
  filter: MethodFilter;
  activeView: WorkbenchView;
  historyCount: number;
  savedCount: number;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: MethodFilter) => void;
  onSelectMethod: (method: string) => void;
  onViewChange: (view: WorkbenchView) => void;
  onExport: () => void;
  onImport: () => void;
}) {
  return (
    <>
      <div className="pp-sidebar-brand">
        <span className="pp-wordmark-icon">
          <Network aria-hidden="true" />
        </span>
        <strong>ProtoPeek</strong>
      </div>

      <div className="pp-service-search">
        <Search aria-hidden="true" />
        <input
          id="method-search"
          value={searchText}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Filter services and methods"
          aria-label="Filter services and methods"
        />
        <kbd>/</kbd>
      </div>

      <fieldset className="pp-method-filters" aria-label="Method type filter">
        {filters.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={filter === entry.value ? 'is-active' : undefined}
            onClick={() => onFilterChange(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </fieldset>

      <div className="pp-service-scroll">
        {services.length ? (
          services.map((service) => (
            <ServiceGroup
              key={service.name}
              service={service}
              selectedMethod={selectedMethod}
              searching={Boolean(searchText.trim())}
              onSelect={onSelectMethod}
            />
          ))
        ) : (
          <p className="pp-sidebar-empty">No methods match this filter.</p>
        )}
      </div>

      <nav className="pp-utility-nav" aria-label="Workbench tools">
        <button
          type="button"
          className={activeView === 'compose' ? 'is-active' : undefined}
          onClick={() => onViewChange('compose')}
        >
          <Server aria-hidden="true" /> Invoke
        </button>
        {utilityViews.map((view) => (
          <button
            key={view.key}
            type="button"
            className={activeView === view.key ? 'is-active' : undefined}
            onClick={() => onViewChange(view.key)}
          >
            <view.icon aria-hidden="true" /> {view.label}
            {view.key === 'history' && historyCount + savedCount > 0 ? (
              <span>{historyCount + savedCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="pp-sidebar-io">
        <button type="button" onClick={onImport}>
          <Upload aria-hidden="true" /> Import
        </button>
        <button type="button" onClick={onExport}>
          <Download aria-hidden="true" /> Export
        </button>
      </div>
    </>
  );
}
