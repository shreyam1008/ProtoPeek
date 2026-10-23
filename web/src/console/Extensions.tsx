import { Link, useSearch } from '@tanstack/react-router';
import { ArrowRight, Pin, Puzzle, Search } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import {
  capabilityLabels,
  type ExtensionId,
  extensionCatalog,
  type SetupPlatform,
  type SingleExtensionSnapshot,
  setupPlatform,
} from './extension-catalog';
import {
  type ExtensionPreferences,
  readExtensionPreferences,
  saveExtensionPreferences,
} from './extension-preferences';
import { PageHeader } from './shell/PageHeader';
import './extensions.css';

const ExtensionDetails = lazy(() => import('./ExtensionDetails'));
const groups = ['All', ...new Set(extensionCatalog.map((entry) => entry.group))];
export function Extensions() {
  const { extension } = useSearch({ from: '/extensions' });
  const [preferences, setPreferences] = useState(readExtensionPreferences);
  const [preferenceError, setPreferenceError] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [hostPlatform, setHostPlatform] = useState<SetupPlatform>();
  const [observations, setObservations] = useState<
    Partial<Record<ExtensionId, SingleExtensionSnapshot>>
  >({});
  function save(next: ExtensionPreferences) {
    setPreferences(next);
    setPreferenceError(
      saveExtensionPreferences(next)
        ? ''
        : 'Preferences could not be saved. Your choices still work for this visit.'
    );
  }
  function pin(id: ExtensionId) {
    save({
      ...preferences,
      pinned: preferences.pinned.includes(id)
        ? preferences.pinned.filter((item) => item !== id)
        : [...preferences.pinned, id],
    });
  }
  const selected = extensionCatalog.find((entry) => entry.id === extension);
  if (extension)
    return (
      <div className="pp-extensions">
        <Link to="/extensions" search={{}} preload={false}>
          ← Extension library
        </Link>
        {preferenceError ? <p role="alert">{preferenceError}</p> : null}
        {selected ? (
          <Suspense fallback={<p role="status">Opening extension setup…</p>}>
            <ExtensionDetails
              key={selected.id}
              entry={selected}
              pinned={preferences.pinned.includes(selected.id)}
              onPin={() => pin(selected.id)}
              platform={preferences.platform ?? hostPlatform}
              onPlatform={(platform) => save({ ...preferences, platform })}
              previous={observations[selected.id]}
              onChecked={(snapshot) => {
                setObservations((current) => ({ ...current, [selected.id]: snapshot }));
                setHostPlatform(setupPlatform(snapshot.platform));
              }}
            />
          </Suspense>
        ) : (
          <section className="pp-panel">
            <h1>Extension not found.</h1>
            <p>Choose one of the supported tools in the library.</p>
          </section>
        )}
      </div>
    );
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible = extensionCatalog
    .filter(
      (entry) =>
        (group === 'All' || entry.group === group) &&
        (!pinnedOnly || preferences.pinned.includes(entry.id)) &&
        tokens.every((token) =>
          `${entry.id} ${entry.name} ${entry.summary} ${entry.group} ${capabilityLabels[entry.capability]} ${entry.id === 'tailscale' ? 'headscale vpn wireguard' : ''}`
            .toLowerCase()
            .includes(token)
        )
    )
    .sort(
      (a, b) =>
        Number(preferences.pinned.includes(b.id)) - Number(preferences.pinned.includes(a.id))
    );
  return (
    <div className="pp-extensions">
      <PageHeader>
        <div>
          <p className="pp-eyebrow">Extensions</p>
          <h1>Add only what you need.</h1>
          <p>
            20 optional tools and companions. Choose a task, review setup, then open its workspace.
          </p>
        </div>
        <Link to="/agents" preload={false}>
          AI agent activity <ArrowRight aria-hidden="true" />
        </Link>
      </PageHeader>
      <aside className="pp-panel pp-extensions-base" aria-label="Included base tools">
        <strong>The core workbench works on its own.</strong>
        <p>
          Browsing, searching and pinning starts nothing. No tools, models or accounts are
          downloaded or connected. Native workbenches, setup guides and external companions are
          labelled separately.
        </p>
        <div>
          <Link to="/protocols">Inspect an API</Link>
          <Link to="/network/local">See nearby devices</Link>
          <Link to="/network/packets" search={{ mode: 'file' }}>
            Read a packet file
          </Link>
        </div>
      </aside>
      <div className="pp-extension-controls">
        <label className="pp-extension-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label="Search extensions"
            value={query}
            maxLength={128}
            placeholder="Search tools, tasks or agents"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <fieldset className="pp-extension-filters" aria-label="Extension categories">
          {groups.map((name) => (
            <button
              type="button"
              key={name}
              aria-pressed={group === name}
              onClick={() => setGroup(name)}
            >
              {name}
            </button>
          ))}
        </fieldset>
        <label className="pp-extension-pinned-filter">
          <input
            type="checkbox"
            checked={pinnedOnly}
            onChange={(event) => setPinnedOnly(event.target.checked)}
          />
          Pinned ({preferences.pinned.length})
        </label>
      </div>
      {preferenceError ? <p role="alert">{preferenceError}</p> : null}
      <p role="status">
        {visible.length} of {extensionCatalog.length} extensions · Installation checks run only when
        requested.
      </p>
      <section className="pp-extension-grid" aria-label="Extension library">
        {visible.map((entry) => {
          const pinned = preferences.pinned.includes(entry.id);
          const observed = observations[entry.id];
          return (
            <article
              key={entry.id}
              className="pp-panel pp-extension-card"
              aria-labelledby={`extension-${entry.id}`}
            >
              <div className="pp-extension-card-heading">
                <Puzzle aria-hidden="true" />
                <div>
                  <h2 id={`extension-${entry.id}`}>{entry.name}</h2>
                  <span>{entry.group}</span>
                </div>
                <button
                  className="pp-extension-pin"
                  type="button"
                  aria-label={`${pinned ? 'Unpin' : 'Pin'} ${entry.name}`}
                  aria-pressed={pinned}
                  onClick={() => pin(entry.id)}
                >
                  <Pin aria-hidden="true" />
                </button>
              </div>
              <span className="pp-extension-level">{capabilityLabels[entry.capability]}</span>
              <p>{entry.summary}</p>
              {observed ? (
                <p>
                  Last checked {new Date(observed.observedAt).toLocaleTimeString()}. Open setup for
                  the observation.
                </p>
              ) : null}
              <div className="pp-extension-actions">
                {entry.route ? (
                  <Link
                    className="pp-button-secondary"
                    to={entry.route}
                    search={entry.id === 'wireshark' ? { mode: 'live' } : {}}
                    preload={false}
                  >
                    {entry.openLabel}
                  </Link>
                ) : null}
                <Link to="/extensions" search={{ extension: entry.id }} preload={false}>
                  {entry.route ? 'Setup & details' : 'Open setup'} <ArrowRight aria-hidden="true" />
                </Link>
              </div>
            </article>
          );
        })}
      </section>
      {!visible.length ? (
        <div className="pp-panel">
          <h2>No matching extensions.</h2>
          <p>Try another name, task or category.</p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setGroup('All');
              setPinnedOnly(false);
            }}
          >
            Clear filters
          </button>
        </div>
      ) : null}
      <p className="pp-extensions-footnote">
        Setup content loads when opened. External tools stay installed and managed separately.
        Windows x64 keeps its existing included aria2 companion; no additional vendor binaries or AI
        runtimes are bundled.
      </p>
    </div>
  );
}
