import { Link, useSearch } from '@tanstack/react-router';
import { ArrowRight, Puzzle, Search } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { CommunityExtensionDetail } from './CommunityExtension';
import { communityCatalog, communityExtension } from './community-catalog';
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
  type PinnedToolId,
  readExtensionPreferences,
  saveExtensionPreferences,
} from './extension-preferences';
import { MediaPacks, matchingMediaPacks, mediaPacks, PinExtension } from './MediaPacks';
import { PageHeader } from './shell/PageHeader';
import './extensions.css';

const ExtensionDetails = lazy(() => import('./ExtensionDetails'));
const groups = [
  'All',
  'Managed',
  'Media',
  ...new Set(extensionCatalog.map((entry) => entry.group)),
];
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
  function pin(id: PinnedToolId) {
    save({
      ...preferences,
      pinned: preferences.pinned.includes(id)
        ? preferences.pinned.filter((item) => item !== id)
        : [...preferences.pinned, id],
    });
  }
  const selected = extensionCatalog.find((entry) => entry.id === extension);
  const selectedCommunity = extension ? communityExtension(extension) : undefined;
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
        ) : selectedCommunity ? (
          <CommunityExtensionDetail
            key={selectedCommunity.id}
            entry={selectedCommunity}
            pinned={preferences.pinned.includes(selectedCommunity.id)}
            onPin={() => pin(selectedCommunity.id)}
          />
        ) : (
          <section className="pp-panel">
            <h1>Extension not found.</h1>
            <p>Choose one of the supported tools in the library.</p>
          </section>
        )}
      </div>
    );
  const managed = (id: string) =>
    id === 'cloudflared' || id === 'aria2' || !!communityExtension(id);
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const media = ['All', 'Managed', 'Media'].includes(group)
    ? matchingMediaPacks(query).filter(
        (pack) => !pinnedOnly || preferences.pinned.includes(pack.id)
      )
    : [];
  const visible = extensionCatalog
    .filter(
      (entry) =>
        (group === 'All' || entry.group === group || (group === 'Managed' && managed(entry.id))) &&
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
  const community = communityCatalog
    .filter((entry) => ['All', 'Managed'].includes(group) || entry.group === group)
    .filter((entry) => !extensionCatalog.some((existing) => existing.id === entry.id))
    .filter((entry) => !pinnedOnly || preferences.pinned.includes(entry.id))
    .filter((entry) =>
      tokens.every((token) =>
        `${entry.id} ${entry.name} ${entry.description} ${entry.group}`
          .toLowerCase()
          .includes(token)
      )
    )
    .sort(
      (a, b) =>
        Number(preferences.pinned.includes(b.id)) - Number(preferences.pinned.includes(a.id))
    );
  const uniqueCommunityCount = communityCatalog.filter(
    (entry) => !extensionCatalog.some((existing) => existing.id === entry.id)
  ).length;
  return (
    <div className="pp-extensions pp-extension-library">
      <PageHeader>
        <h1>Extension library</h1>
        <Link to="/agents" preload={false}>
          AI agent activity
        </Link>
      </PageHeader>
      <details className="pp-panel pp-extensions-base" aria-label="Included base tools">
        <summary>What is included and what needs setup?</summary>
        <p>Browse built-in tools below. Optional companions run when you choose them.</p>
        <div>
          <Link to="/protocols">Inspect an API</Link>
          <Link to="/network/local">See nearby devices</Link>
          <Link to="/network/packets" search={{ mode: 'file' }}>
            Read a packet file
          </Link>
        </div>
      </details>
      <div className="pp-extension-controls">
        <label className="pp-ext-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label="Search extensions"
            value={query}
            maxLength={128}
            placeholder="Search tools"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="pp-extension-filter-row">
          <label className="pp-ext-pinned-filter pp-mobile-category">
            Category
            <select value={group} onChange={(event) => setGroup(event.target.value)}>
              {groups.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="pp-ext-filters" aria-label="Extension categories">
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
          <label className="pp-ext-pinned-filter">
            <input
              type="checkbox"
              checked={pinnedOnly}
              onChange={(event) => setPinnedOnly(event.target.checked)}
            />
            Pinned ({preferences.pinned.length})
          </label>
        </div>
      </div>
      {preferenceError ? <p role="alert">{preferenceError}</p> : null}
      <p role="status">
        {visible.length + media.length + community.length} of{' '}
        {extensionCatalog.length + mediaPacks.length + uniqueCommunityCount} tools
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
                <PinExtension name={entry.name} pinned={pinned} onPin={() => pin(entry.id)} />
              </div>
              <span className="pp-extension-level">
                {entry.id === 'aria2'
                  ? 'Managed on Windows x64'
                  : managed(entry.id)
                    ? 'Managed companion'
                    : capabilityLabels[entry.capability]}
              </span>
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
                {entry.id === 'nmap' && (
                  <Link to="/network/map" hash="import-nmap-xml" preload={false}>
                    Open XML import
                  </Link>
                )}
                {entry.id === 'wireshark' && (
                  <Link to="/network/packets" search={{ mode: 'file' }} preload={false}>
                    Open packet reader
                  </Link>
                )}
                <Link to="/extensions" search={{ extension: entry.id }} preload={false}>
                  {entry.route ? 'Setup & details' : 'Open setup'} <ArrowRight aria-hidden="true" />
                </Link>
              </div>
            </article>
          );
        })}
        {community.map((entry) => (
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
              <PinExtension
                name={entry.name}
                pinned={preferences.pinned.includes(entry.id)}
                onPin={() => pin(entry.id)}
              />
            </div>
            <span className="pp-extension-level">Managed CLI companion</span>
            <p>{entry.description}</p>
            <div className="pp-extension-actions">
              <Link to="/extensions" search={{ extension: entry.id }} preload={false}>
                Open setup <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </article>
        ))}
        <MediaPacks packs={media} pinned={preferences.pinned} onPin={pin} />
      </section>
      {!visible.length && !media.length && !community.length ? (
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
    </div>
  );
}
