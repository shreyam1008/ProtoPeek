import { Link, useBlocker, useLocation } from '@tanstack/react-router';
import { Clock3, FolderOpen, Map as MapIcon, Radar, Route, Save } from 'lucide-react';
import { lazy, Suspense, useRef } from 'react';

import { NetworkPathPanel } from '@/console/NetworkPathPanel';
import type { NetworkStore } from '@/console/network-store';
import { NetworkHistoryPage } from './history/NetworkHistoryPage';
import { loadTopologyCanvas, NetworkMapPage } from './topology/NetworkMapPage';
import { useNetworkWorkspace } from './useNetworkWorkspace';

const loadLocalNetworkPanel = () => import('@/console/LocalNetworkPanel');
const LazyLocalNetworkPanel = lazy(async () => {
  const module = await loadLocalNetworkPanel();
  return { default: module.LocalNetworkPanel };
});

type NetworkSection = 'path' | 'local' | 'map' | 'history';

function isNetworkWorkbenchPath(pathname: string) {
  return pathname === '/network' || pathname.startsWith('/network/');
}

function sectionFromPath(pathname: string): NetworkSection {
  if (!isNetworkWorkbenchPath(pathname)) return 'path';
  const candidate = pathname.split('/').filter(Boolean).at(-1);
  return candidate === 'local' || candidate === 'map' || candidate === 'history'
    ? candidate
    : 'path';
}

export function NetworkRoute({ store }: { store?: NetworkStore }) {
  const location = useLocation();
  const section = sectionFromPath(location.pathname);
  const importRef = useRef<HTMLInputElement | null>(null);
  const {
    activeID,
    deleteConfirmation,
    deleteWorkspace,
    dirty,
    discardEdits,
    editWorkspace,
    exportWorkspace,
    health,
    importWorkspace,
    loadingStore,
    notice,
    restoreConfirmation,
    restoreSnapshot,
    saveEdits,
    saveLocalSnapshot,
    savePathTrace,
    selectWorkspace,
    workspace,
    workspaces,
  } = useNetworkWorkspace(store);
  const navigationBlocker = useBlocker({
    shouldBlockFn: ({ next }) => dirty && !isNetworkWorkbenchPath(next.pathname),
    enableBeforeUnload: dirty,
    withResolver: true,
  });

  return (
    <div className="pp-network-workbench">
      <header className="pp-network-masthead">
        <div>
          <span className="pp-kicker">Measured from this ProtoPeek process</span>
          <strong className="pp-network-title">Network workbench</strong>
        </div>
        <nav aria-label="Network workbench sections">
          <Link
            to="/network/path"
            className="pp-network-nav-link"
            activeProps={{ className: 'is-active' }}
          >
            <Route aria-hidden="true" /> Path
          </Link>
          <Link
            to="/network/local"
            className="pp-network-nav-link"
            activeProps={{ className: 'is-active' }}
            onFocus={() => void loadLocalNetworkPanel()}
            onMouseEnter={() => void loadLocalNetworkPanel()}
          >
            <Radar aria-hidden="true" /> Local scan
          </Link>
          <Link
            to="/network/map"
            className="pp-network-nav-link"
            activeProps={{ className: 'is-active' }}
            onFocus={() => void loadTopologyCanvas()}
            onMouseEnter={() => void loadTopologyCanvas()}
          >
            <MapIcon aria-hidden="true" /> Map
          </Link>
          <Link
            to="/network/history"
            className="pp-network-nav-link"
            activeProps={{ className: 'is-active' }}
          >
            <Clock3 aria-hidden="true" /> History
          </Link>
        </nav>
        <div className="pp-network-file-actions">
          <input
            ref={importRef}
            type="file"
            disabled={dirty}
            accept=".json,.graphml,.xml,application/json,application/graphml+xml"
            aria-label="Import network workspace"
            onChange={(event) => void importWorkspace(event)}
          />
          <button
            type="button"
            disabled={dirty}
            title={dirty ? 'Save or discard map edits before importing.' : undefined}
            onClick={() => importRef.current?.click()}
          >
            <FolderOpen aria-hidden="true" /> Import
          </button>
          <span>{workspaces.length}/20 saved</span>
        </div>
      </header>

      {health?.mode === 'session-only' && health.error ? (
        <aside className="pp-network-storage-warning" role="status">
          {health.error}
        </aside>
      ) : null}
      {notice ? (
        <p className="pp-network-notice" role="status">
          {notice}
        </p>
      ) : null}
      {dirty ? (
        <aside className="pp-network-dirty" role="status">
          <span>Unsaved map edits stay in this tab until you save or discard them.</span>
          <button type="button" onClick={() => void saveEdits()}>
            <Save aria-hidden="true" /> Save
          </button>
          <button type="button" onClick={() => void discardEdits()}>
            Discard
          </button>
        </aside>
      ) : null}
      {navigationBlocker.status === 'blocked' ? (
        <div
          className="pp-network-leave-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="network-leave-title"
        >
          <div>
            <h2 id="network-leave-title">Leave with unsaved map edits?</h2>
            <p>Save them to browser storage, discard them, or stay in the network workbench.</p>
            <div>
              <button
                type="button"
                className="is-primary"
                onClick={() =>
                  void saveEdits().then((saved) => {
                    if (saved) navigationBlocker.proceed?.();
                  })
                }
              >
                Save and leave
              </button>
              <button type="button" onClick={() => navigationBlocker.proceed?.()}>
                Leave without saving
              </button>
              <button type="button" onClick={() => navigationBlocker.reset?.()}>
                Stay
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {section === 'path' ? <NetworkPathPanel onSaveTrace={savePathTrace} /> : null}
      {section === 'local' ? (
        <div className="pp-network-local-page">
          <Suspense fallback={<p className="pp-network-loading">Loading local scan…</p>}>
            <LazyLocalNetworkPanel onSaveSnapshot={saveLocalSnapshot} />
          </Suspense>
        </div>
      ) : null}
      {section === 'map' ? (
        <NetworkMapPage
          loading={loadingStore}
          workspace={workspace}
          workspaces={workspaces}
          dirty={dirty}
          onSelect={(id) => void selectWorkspace(id)}
          onChange={editWorkspace}
          onSave={() => void saveEdits()}
          onExport={exportWorkspace}
        />
      ) : null}
      {section === 'history' ? (
        <NetworkHistoryPage
          loading={loadingStore}
          workspace={workspace}
          workspaces={workspaces}
          activeID={activeID}
          deleteConfirmation={deleteConfirmation}
          restoreConfirmation={restoreConfirmation}
          dirty={dirty}
          onSelect={(id) => void selectWorkspace(id)}
          onRestore={(id) => void restoreSnapshot(id)}
          onDelete={(id) => void deleteWorkspace(id)}
          onExport={exportWorkspace}
        />
      ) : null}
    </div>
  );
}
