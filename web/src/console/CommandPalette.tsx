import { Command, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
};

export function CommandPalette({
  open,
  actions,
  onClose,
}: {
  open: boolean;
  actions: PaletteAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const visibleActions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) =>
      `${action.label} ${action.keywords ?? ''}`.toLowerCase().includes(normalized)
    );
  }, [actions, query]);

  if (!open) return null;

  function run(action: PaletteAction) {
    onClose();
    action.run();
  }

  return (
    <div className="pp-command-backdrop">
      <button
        type="button"
        className="pp-command-dismiss"
        aria-label="Close command palette"
        onClick={onClose}
      />
      <section
        className="pp-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="ProtoPeek commands"
      >
        <div className="pp-command-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && visibleActions[0]) run(visibleActions[0]);
            }}
            placeholder="Type a command or method"
            aria-label="Search commands"
          />
          <button type="button" aria-label="Close command palette" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="pp-command-list">
          {visibleActions.length ? (
            visibleActions.map((action) => (
              <button key={action.id} type="button" onClick={() => run(action)}>
                <Command aria-hidden="true" />
                <span>{action.label}</span>
                {action.hint ? <kbd>{action.hint}</kbd> : null}
              </button>
            ))
          ) : (
            <p>No matching command.</p>
          )}
        </div>
      </section>
    </div>
  );
}
