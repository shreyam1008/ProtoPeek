import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useDialogFocus } from './use-dialog-focus';

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
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const paletteRef = useRef<HTMLElement | null>(null);
  const resultListId = useId();
  useDialogFocus(open, onClose, paletteRef, inputRef);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
  }, [open]);

  const visibleActions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) =>
      `${action.label} ${action.keywords ?? ''}`.toLowerCase().includes(normalized)
    );
  }, [actions, query]);
  const visibleActiveIndex = activeIndex < visibleActions.length ? activeIndex : 0;
  const activeAction = visibleActions[visibleActiveIndex];

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
        ref={paletteRef}
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
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-activedescendant={
              activeAction ? `${resultListId}-result-${visibleActiveIndex}` : undefined
            }
            aria-controls={resultListId}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (visibleActions.length) {
                  setActiveIndex((visibleActiveIndex + 1) % visibleActions.length);
                }
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (visibleActions.length) {
                  setActiveIndex(
                    (visibleActiveIndex - 1 + visibleActions.length) % visibleActions.length
                  );
                }
              } else if (event.key === 'Enter' && activeAction) {
                event.preventDefault();
                run(activeAction);
              }
            }}
            placeholder="Type a command or method"
            aria-label="Search commands"
          />
          <button type="button" aria-label="Close command palette" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div id={resultListId} className="pp-command-list" role="listbox" aria-label="Commands">
          {visibleActions.length ? (
            visibleActions.map((action, index) => (
              <button
                key={action.id}
                id={`${resultListId}-result-${index}`}
                type="button"
                role="option"
                className={action === activeAction ? 'is-active' : undefined}
                aria-selected={action === activeAction}
                onPointerMove={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => run(action)}
              >
                <span>{action.label}</span>
                {action.hint ? <kbd>{action.hint}</kbd> : null}
              </button>
            ))
          ) : (
            <p role="status" aria-live="polite">
              No matching command.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
