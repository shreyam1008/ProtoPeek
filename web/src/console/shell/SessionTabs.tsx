import { Link } from '@tanstack/react-router';
import { Download, type LucideIcon, Network, Puzzle, Search, Settings, X } from 'lucide-react';
import { type KeyboardEvent, useEffect } from 'react';

import type { DestinationId } from '../app/feature-registry';
import type { SessionReference } from './shell-state';

const sessionIcons: Record<DestinationId, LucideIcon> = {
  home: Search,
  inspect: Search,
  network: Network,
  extensions: Puzzle,
  files: Download,
  settings: Settings,
};

function recentToolID(id: string) {
  return `pp-session-${id.replace(/[^a-z0-9]+/gi, '-')}`;
}

export function SessionTabs({
  references,
  activeId,
  onActivate,
  onRemove,
}: {
  references: readonly SessionReference[];
  activeId: string | null;
  onActivate: (reference: SessionReference) => void;
  onRemove: (reference: SessionReference) => void;
}) {
  useEffect(() => {
    if (!activeId) return;
    document
      .getElementById(recentToolID(activeId))
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  if (!references.length) return null;

  function moveFocus(event: KeyboardEvent<HTMLAnchorElement>, reference: SessionReference) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const current = references.findIndex((candidate) => candidate.id === reference.id);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? references.length - 1
          : (current +
              (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) +
              references.length) %
            references.length;
    const next = references[nextIndex];
    if (next) document.getElementById(recentToolID(next.id))?.focus();
  }

  return (
    <div className="pp-session-strip">
      <span className="pp-session-heading">Recent tools</span>
      <nav className="pp-session-tabs" aria-label="Recent tools">
        {references.map((reference, index) => {
          const Icon = sessionIcons[reference.destination];
          const selected = reference.id === activeId;
          return (
            <div key={reference.id} className="pp-session-item">
              <Link
                id={recentToolID(reference.id)}
                to={reference.route}
                activeOptions={{ exact: true }}
                aria-current={selected ? 'page' : undefined}
                className="pp-session-tab"
                onClick={() => onActivate(reference)}
                onKeyDown={(event) => moveFocus(event, reference)}
              >
                <Icon aria-hidden="true" />
                <span>{reference.label}</span>
              </Link>
              <button
                type="button"
                className="pp-session-close"
                aria-label={`Remove ${reference.label} from recent tools`}
                onClick={(event) => {
                  if (document.activeElement === event.currentTarget) {
                    const next = references[index + 1] ?? references[index - 1];
                    const focusTarget = next
                      ? document.getElementById(recentToolID(next.id))
                      : event.currentTarget.closest('details')?.querySelector('summary');
                    focusTarget?.focus();
                  }
                  onRemove(reference);
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
