import { Cloud, Download, type LucideIcon, Network, Search, Settings, X } from 'lucide-react';
import { type KeyboardEvent, useEffect } from 'react';

import type { DestinationId } from '../app/feature-registry';
import type { SessionReference } from './shell-state';

const sessionIcons: Record<DestinationId, LucideIcon> = {
  home: Search,
  inspect: Search,
  network: Network,
  publish: Cloud,
  files: Download,
  settings: Settings,
};

function tabID(id: string) {
  return `pp-session-${id.replace(/[^a-z0-9]+/gi, '-')}`;
}

export function SessionTabs({
  references,
  activeId,
  onActivate,
  onClose,
}: {
  references: readonly SessionReference[];
  activeId: string | null;
  onActivate: (reference: SessionReference) => void;
  onClose: (reference: SessionReference) => void;
}) {
  useEffect(() => {
    if (!activeId) return;
    document
      .getElementById(tabID(activeId))
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  if (!references.length) return null;

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, reference: SessionReference) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = references.findIndex((candidate) => candidate.id === reference.id);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? references.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + references.length) %
            references.length;
    const next = references[nextIndex];
    if (next) document.getElementById(tabID(next.id))?.focus();
  }

  return (
    <div className="pp-session-strip">
      <div className="pp-session-tabs" role="tablist" aria-label="Open workbench sessions">
        {references.map((reference, index) => {
          const Icon = sessionIcons[reference.destination];
          const selected = reference.id === activeId;
          const guarded = reference.dirty || reference.running;
          const state = reference.running ? 'Running' : reference.dirty ? 'Unsaved' : '';
          return (
            <div key={reference.id} className="pp-session-item" role="presentation">
              <button
                id={tabID(reference.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="pp-workbench-canvas"
                tabIndex={selected || (!activeId && index === 0) ? 0 : -1}
                className="pp-session-tab"
                onClick={() => onActivate(reference)}
                onKeyDown={(event) => moveFocus(event, reference)}
              >
                <Icon aria-hidden="true" />
                <span>{reference.label}</span>
                <small>{state}</small>
              </button>
              {guarded ? null : (
                <button
                  type="button"
                  className="pp-session-close"
                  aria-label={`Close ${reference.label} session`}
                  onClick={() => onClose(reference)}
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
