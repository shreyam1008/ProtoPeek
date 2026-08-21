import { Link, useBlocker, useLocation, useNavigate } from '@tanstack/react-router';
import {
  Clock3,
  Download,
  FileJson,
  FolderOpen,
  Map as MapIcon,
  Network,
  Plus,
  Radar,
  Route,
  Save,
  Trash2,
} from 'lucide-react';
import { type ChangeEvent, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { NetworkPathPanel } from './NetworkPathPanel';
import {
  exportNetworkGraphML,
  exportNetworkInventoryCSV,
  importNetworkGraphML,
  type NetworkGraphMLImportResult,
  type NetworkGroup,
  type NetworkSnapshot,
  type NetworkWorkspaceV1,
  networkGraphMLExportLosses,
  networkWorkspaceLimits,
  parseNetworkWorkspaceJSON,
  serializeNetworkWorkspace,
} from './network-model';
import type { PathTrace } from './network-path';
import { NetworkStore, type NetworkStoreHealth, type NetworkStoreMetadata } from './network-store';
import {
  appendNetworkObservation,
  createWorkspaceFromSnapshot,
  restoreNetworkSnapshot,
} from './network-workspace';
import { pathTraceToNetworkWorkspace } from './path-to-network';
import './network.css';

const loadTopologyCanvas = () => import('./TopologyCanvas');
const LazyTopologyCanvas = lazy(async () => {
  const module = await loadTopologyCanvas();
  return { default: module.TopologyCanvas };
});
const loadLocalNetworkPanel = () => import('./LocalNetworkPanel');
const LazyLocalNetworkPanel = lazy(async () => {
  const module = await loadLocalNetworkPanel();
  return { default: module.LocalNetworkPanel };
});

type NetworkSection = 'path' | 'local' | 'map' | 'history';

const defaultNetworkStore = new NetworkStore();

function sectionFromPath(pathname: string): NetworkSection {
  const candidate = pathname.split('/').filter(Boolean).at(-1);
  return candidate === 'local' || candidate === 'map' || candidate === 'history'
    ? candidate
    : 'path';
}

export function NetworkWorkbench({ store = defaultNetworkStore }: { store?: NetworkStore }) {
  const location = useLocation();
  const navigate = useNavigate();
  const section = sectionFromPath(location.pathname);
  const [workspaces, setWorkspaces] = useState<readonly NetworkStoreMetadata[]>([]);
  const [activeID, setActiveID] = useState('');
  const [workspace, setWorkspace] = useState<NetworkWorkspaceV1 | null>(null);
  const [health, setHealth] = useState<NetworkStoreHealth | null>(null);
  const [loadingStore, setLoadingStore] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [restoreConfirmation, setRestoreConfirmation] = useState('');
  const importRef = useRef<HTMLInputElement | null>(null);
  const activeIDRef = useRef('');
  const dirtyRef = useRef(false);
  const persistedWorkspaceRef = useRef<NetworkWorkspaceV1 | null>(null);
  const editRevisionRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const navigationBlocker = useBlocker({
    shouldBlockFn: ({ next }) => dirty && !next.pathname.startsWith('/network'),
    enableBeforeUnload: dirty,
    withResolver: true,
  });

  const commitWorkspaceView = useCallback(
    (nextWorkspace: NetworkWorkspaceV1 | null, nextActiveID: string, nextDirty: boolean) => {
      activeIDRef.current = nextActiveID;
      dirtyRef.current = nextDirty;
      if (!nextDirty) persistedWorkspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
      setActiveID(nextActiveID);
      setDirty(nextDirty);
    },
    []
  );

  function editWorkspace(next: NetworkWorkspaceV1) {
    editRevisionRef.current += 1;
    dirtyRef.current = true;
    setWorkspace(next);
    setDirty(true);
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const initialized = await store.initialize();
      const listed = await store.list();
      if (!mounted) return;
      setHealth(initialized.mode === 'session-only' ? initialized : listed.health);
      if (listed.error !== null) {
        setNotice(listed.error.message);
        setLoadingStore(false);
        return;
      }
      setWorkspaces(listed.value);
      const first = listed.value[0];
      if (first) {
        const loaded = await store.get(first.id);
        if (!mounted) return;
        if (loaded.error !== null) setNotice(loaded.error.message);
        else if (loaded.value) {
          commitWorkspaceView(loaded.value, first.id, false);
        } else {
          setNotice(`Saved workspace ${first.id} was not found.`);
        }
      }
      setLoadingStore(false);
    })();
    return () => {
      mounted = false;
    };
  }, [store, commitWorkspaceView]);

  async function refreshMetadata(preferredID = activeIDRef.current) {
    const listed = await store.list();
    setHealth(listed.health);
    if (listed.error !== null) {
      setNotice(listed.error.message);
      return;
    }
    setWorkspaces(listed.value);
    if (preferredID && listed.value.some(({ id }) => id === preferredID)) return;
    const first = listed.value[0];
    if (!first) {
      commitWorkspaceView(null, '', false);
      return;
    }
    await selectWorkspace(first.id);
  }

  async function selectWorkspace(id: string, force = false) {
    if (!force && dirtyRef.current && id !== activeIDRef.current) {
      setNotice('Save or discard the current map edits before switching workspaces.');
      return false;
    }
    const generation = ++loadGenerationRef.current;
    const loaded = await store.get(id);
    if (generation !== loadGenerationRef.current) return false;
    setHealth(loaded.health);
    if (loaded.error !== null) {
      setNotice(loaded.error.message);
      return false;
    }
    if (!loaded.value) {
      setNotice(`Saved workspace ${id} was not found.`);
      return false;
    }
    commitWorkspaceView(loaded.value, id, false);
    setDeleteConfirmation('');
    setRestoreConfirmation('');
    return true;
  }

  async function persistWorkspace(
    next: NetworkWorkspaceV1,
    successMessage: string,
    options: {
      expectedPrevious: NetworkWorkspaceV1 | null;
      protectConcurrentEdits?: boolean;
    }
  ) {
    const generation = ++loadGenerationRef.current;
    const revision = editRevisionRef.current;
    const startingActiveID = activeIDRef.current;
    const saved = await store.put(next, { expectedPrevious: options.expectedPrevious });
    setHealth(saved.health);
    if (saved.error !== null) {
      setNotice(saved.error.message);
      return false;
    }
    persistedWorkspaceRef.current = next;
    const concurrentEdit =
      options.protectConcurrentEdits &&
      (editRevisionRef.current !== revision || activeIDRef.current !== startingActiveID);
    if (generation === loadGenerationRef.current && !concurrentEdit) {
      commitWorkspaceView(next, next.id, false);
    }
    await refreshMetadata(next.id);
    if (concurrentEdit) {
      setNotice(`${successMessage} Newer edits remain unsaved.`);
      return false;
    }
    setNotice(successMessage);
    return true;
  }

  async function findWorkspace(
    predicate: (candidate: NetworkWorkspaceV1) => boolean
  ): Promise<NetworkWorkspaceV1 | null> {
    if (workspace && predicate(workspace)) return workspace;
    for (const candidate of workspaces) {
      if (candidate.id === workspace?.id) continue;
      const loaded = await store.get(candidate.id);
      if (loaded.error === null && loaded.value && predicate(loaded.value)) return loaded.value;
    }
    return null;
  }

  async function savePathTrace(trace: PathTrace) {
    if (dirtyRef.current) {
      setNotice('Save or discard the current map edits before saving a new path observation.');
      return false;
    }
    try {
      const observation = pathTraceToNetworkWorkspace(trace, { tags: ['path-trace'] });
      const current = await findWorkspace(
        (candidate) => candidate.tags.includes('path-trace') && candidate.name === observation.name
      );
      const next = current ? appendNetworkObservation(current, observation) : observation;
      return await persistWorkspace(
        next,
        current
          ? `Appended a new immutable path snapshot to ${next.name}.`
          : `Saved ${next.name} as a network workspace.`,
        { expectedPrevious: current }
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Path evidence could not be saved.');
      return false;
    }
  }

  async function saveLocalSnapshot(snapshot: NetworkSnapshot) {
    if (dirtyRef.current) {
      setNotice('Save or discard the current map edits before saving a new network snapshot.');
      return false;
    }
    try {
      const observation = createWorkspaceFromSnapshot(snapshot);
      const scope = snapshot.groups.find((group) => group.kind === 'subnet')?.cidr ?? '';
      const current = scope
        ? await findWorkspace(
            (candidate) =>
              candidate.tags.includes('local-network') &&
              candidate.groups.some((group) => group.kind === 'subnet' && group.cidr === scope)
          )
        : null;
      const next = current ? appendNetworkObservation(current, observation) : observation;
      return await persistWorkspace(
        next,
        current
          ? `Appended a new immutable ${scope} snapshot.`
          : `Saved ${snapshot.label} as a network workspace.`,
        { expectedPrevious: current }
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Network snapshot could not be saved.');
      return false;
    }
  }

  async function saveEdits() {
    if (!workspace) return;
    return persistWorkspace(workspace, `Saved edits to ${workspace.name}.`, {
      expectedPrevious: persistedWorkspaceRef.current,
      protectConcurrentEdits: true,
    });
  }

  async function discardEdits() {
    const id = activeIDRef.current;
    if (!id) return;
    if (await selectWorkspace(id, true)) setNotice('Discarded unsaved map edits.');
  }

  async function restoreSnapshot(snapshotID: string) {
    if (!workspace) return;
    if (dirtyRef.current) {
      setNotice('Save or discard the current map edits before restoring a snapshot.');
      return;
    }
    if (restoreConfirmation !== snapshotID) {
      setRestoreConfirmation(snapshotID);
      setNotice(
        'Press confirm restore to replace the editable current map. Immutable snapshots remain available.'
      );
      return;
    }
    setRestoreConfirmation('');
    try {
      const restored = restoreNetworkSnapshot(workspace, snapshotID);
      if (
        await persistWorkspace(restored, 'Restored the snapshot as the current map.', {
          expectedPrevious: workspace,
        })
      ) {
        void navigate({ to: '/network/map' });
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Snapshot could not be restored.');
    }
  }

  async function deleteWorkspace(id: string) {
    if (dirtyRef.current && id === activeIDRef.current) {
      setNotice('Save or discard the current map edits before deleting this workspace.');
      return;
    }
    if (deleteConfirmation !== id) {
      setDeleteConfirmation(id);
      setNotice(
        'Press delete again to remove this browser-stored workspace. Export it first if needed.'
      );
      return;
    }
    const deleted = await store.delete(id);
    setHealth(deleted.health);
    if (deleted.error !== null) {
      setNotice(deleted.error.message);
      return;
    }
    setDeleteConfirmation('');
    if (activeIDRef.current === id) {
      commitWorkspaceView(null, '', false);
    }
    await refreshMetadata('');
    setNotice('Workspace removed from this browser profile. This cannot be undone here.');
  }

  async function importWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (dirtyRef.current) {
      setNotice('Save or discard the current map edits before importing another workspace.');
      return;
    }
    if (file.size > networkWorkspaceLimits.maxJSONBytes) {
      setNotice('Network import exceeds the 4 MiB limit.');
      return;
    }
    try {
      const content = await file.text();
      const graphML = /\.graphml$|\.xml$/i.test(file.name) || /^\s*</.test(content);
      const imported = graphML ? importNetworkGraphML(content) : parseNetworkWorkspaceJSON(content);
      const graphMLLosses = graphML
        ? (imported as NetworkGraphMLImportResult).losses
        : ([] as const);
      if (imported.error !== null) {
        setNotice(imported.error);
        return;
      }
      if (workspaces.some(({ id }) => id === imported.value.id)) {
        setNotice(
          `Workspace id ${imported.value.id} already exists. ProtoPeek did not overwrite it.`
        );
        return;
      }
      const saved = await persistWorkspace(
        imported.value,
        graphML
          ? `Imported GraphML with declared losses: ${graphMLLosses.join(' ')}`
          : `Imported lossless ${imported.value.format} v${imported.value.version} JSON.`,
        { expectedPrevious: null }
      );
      if (saved) void navigate({ to: '/network/map' });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Network import failed.');
    }
  }

  function exportWorkspace(kind: 'json' | 'graphml' | 'csv') {
    if (!workspace) return;
    try {
      if (kind === 'json') {
        downloadText(
          `${fileStem(workspace.name)}.protopeek-network.json`,
          serializeNetworkWorkspace(workspace),
          'application/json'
        );
        setNotice('Exported lossless ProtoPeek Network JSON.');
      } else if (kind === 'graphml') {
        const exported = exportNetworkGraphML(workspace);
        downloadText(
          `${fileStem(workspace.name)}.graphml`,
          exported.content,
          'application/graphml+xml'
        );
        setNotice(`Exported GraphML. Declared losses: ${exported.losses.join(' ')}`);
      } else {
        downloadText(
          `${fileStem(workspace.name)}-inventory.csv`,
          exportNetworkInventoryCSV(workspace),
          'text/csv'
        );
        setNotice('Exported the current node inventory as CSV.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Network export failed.');
    }
  }

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

function NetworkMapPage({
  loading,
  workspace,
  workspaces,
  dirty,
  onSelect,
  onChange,
  onSave,
  onExport,
}: {
  loading: boolean;
  workspace: NetworkWorkspaceV1 | null;
  workspaces: readonly NetworkStoreMetadata[];
  dirty: boolean;
  onSelect: (id: string) => void;
  onChange: (workspace: NetworkWorkspaceV1) => void;
  onSave: () => void;
  onExport: (kind: 'json' | 'graphml' | 'csv') => void;
}) {
  return (
    <section className="pp-network-map-page" aria-labelledby="network-map-title">
      <header className="pp-network-page-heading">
        <div>
          <span className="pp-kicker">Infinite drafting surface + accessible inventory</span>
          <h1 id="network-map-title">Network evidence map</h1>
          <p>
            Arrange logical evidence by subnet, site, VLAN, region, or your own groups. Lines show
            observed or manual relationships, not physical cabling.
          </p>
        </div>
        <WorkspacePicker
          workspaces={workspaces}
          workspace={workspace}
          dirty={dirty}
          onSelect={onSelect}
        />
      </header>

      {loading ? <p className="pp-network-loading">Loading saved workspaces…</p> : null}
      {!loading && !workspace ? <NetworkEmptyState /> : null}
      {workspace ? (
        <>
          <section className="pp-workspace-editor" aria-label="Workspace details and export">
            <label>
              <span>Workspace name</span>
              <input
                value={workspace.name}
                maxLength={512}
                onChange={(event) =>
                  onChange({
                    ...workspace,
                    name: event.target.value,
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
            </label>
            <label>
              <span>Tags</span>
              <input
                value={workspace.tags.join(', ')}
                placeholder="production, mumbai, vlan-20"
                onChange={(event) =>
                  onChange({
                    ...workspace,
                    tags: uniqueTags(event.target.value),
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
            </label>
            <button type="button" className="is-primary" disabled={!dirty} onClick={onSave}>
              <Save aria-hidden="true" /> {dirty ? 'Save edits' : 'Saved'}
            </button>
            <ExportActions onExport={onExport} />
          </section>
          <GroupEditor workspace={workspace} onChange={onChange} />
          <Suspense fallback={<p className="pp-network-loading">Loading interactive map…</p>}>
            <LazyTopologyCanvas workspace={workspace} onChange={onChange} />
          </Suspense>
        </>
      ) : null}
    </section>
  );
}

function WorkspacePicker({
  workspaces,
  workspace,
  dirty,
  onSelect,
}: {
  workspaces: readonly NetworkStoreMetadata[];
  workspace: NetworkWorkspaceV1 | null;
  dirty: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <label className="pp-workspace-picker">
      <span>Current workspace</span>
      <select
        value={workspace?.id ?? ''}
        disabled={dirty}
        title={dirty ? 'Save or discard edits before switching workspaces.' : undefined}
        onChange={(event) => onSelect(event.target.value)}
      >
        {workspaces.length === 0 ? <option value="">No saved workspace</option> : null}
        {workspaces.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name || candidate.id} · {candidate.nodeCount} nodes
          </option>
        ))}
      </select>
    </label>
  );
}

function GroupEditor({
  workspace,
  onChange,
}: {
  workspace: NetworkWorkspaceV1;
  onChange: (workspace: NetworkWorkspaceV1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NetworkGroup['kind']>('subnet');
  const [name, setName] = useState('');
  const [detail, setDetail] = useState('');
  const detailError = manualGroupDetailError(kind, detail);
  const showDetailError = Boolean(detailError && (name.trim() || detail.trim()));

  function addGroup() {
    const normalizedName = name.trim();
    if (!normalizedName || detailError) return;
    const now = new Date().toISOString();
    const sequence = workspace.groups.length + 1;
    const group: NetworkGroup = {
      id: `group-${Date.now()}-${sequence}`,
      kind,
      name: normalizedName,
      tags: [],
      notes: '',
      regionCode: kind === 'region' ? detail.trim().toUpperCase() : '',
      siteCode: kind === 'site' ? detail.trim() : '',
      vlanId: kind === 'vlan' ? Number(detail) : null,
      cidr: kind === 'subnet' ? detail.trim() : '',
      position: { x: sequence * 70, y: sequence * 50, pinned: false },
      provenance: [
        {
          kind: 'manual',
          source: 'manual',
          observedAt: now,
          detail: 'User-created organizational group; not discovered network evidence.',
        },
      ],
    };
    onChange({
      ...workspace,
      updatedAt: now,
      groups: [...workspace.groups, group],
      snapshots: workspace.snapshots,
    });
    setName('');
    setDetail('');
    setOpen(false);
  }

  return (
    <details
      className="pp-group-editor"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Plus aria-hidden="true" /> Add an organizational group
        <small>{workspace.groups.length} groups · manual evidence</small>
      </summary>
      <div>
        <label>
          Type
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as NetworkGroup['kind']);
              setDetail('');
            }}
          >
            <option value="subnet">Subnet</option>
            <option value="vlan">VLAN</option>
            <option value="site">Site</option>
            <option value="region">Region</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Name
          <input
            value={name}
            maxLength={networkWorkspaceLimits.maxLabelBytes}
            onChange={(event) => setName(event.target.value)}
            placeholder="Payments subnet"
          />
        </label>
        <label>
          {kind === 'subnet'
            ? 'CIDR'
            : kind === 'vlan'
              ? 'VLAN ID'
              : kind === 'region'
                ? 'Region code'
                : kind === 'site'
                  ? 'Site code'
                  : 'Optional code'}
          <input
            type={kind === 'vlan' ? 'number' : 'text'}
            min={kind === 'vlan' ? 1 : undefined}
            max={kind === 'vlan' ? 4094 : undefined}
            maxLength={kind === 'vlan' ? undefined : networkWorkspaceLimits.maxValueBytes}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder={kind === 'subnet' ? '10.20.0.0/24' : kind === 'vlan' ? '20' : 'BOM'}
          />
        </label>
        {showDetailError ? (
          <p className="pp-group-error" role="alert">
            {detailError}
          </p>
        ) : null}
        <button type="button" disabled={!name.trim() || Boolean(detailError)} onClick={addGroup}>
          Add group
        </button>
      </div>
    </details>
  );
}

function NetworkHistoryPage({
  loading,
  workspace,
  workspaces,
  activeID,
  deleteConfirmation,
  restoreConfirmation,
  dirty,
  onSelect,
  onRestore,
  onDelete,
  onExport,
}: {
  loading: boolean;
  workspace: NetworkWorkspaceV1 | null;
  workspaces: readonly NetworkStoreMetadata[];
  activeID: string;
  deleteConfirmation: string;
  restoreConfirmation: string;
  dirty: boolean;
  onSelect: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (kind: 'json' | 'graphml' | 'csv') => void;
}) {
  return (
    <section className="pp-network-history" aria-labelledby="network-history-title">
      <header className="pp-network-page-heading">
        <div>
          <span className="pp-kicker">Browser-local, bounded, exportable</span>
          <h1 id="network-history-title">Network history</h1>
          <p>
            Every saved observation remains an immutable snapshot. Current labels and layout can
            change without rewriting earlier evidence.
          </p>
        </div>
        {workspace ? <ExportActions onExport={onExport} /> : null}
      </header>
      {loading ? <p className="pp-network-loading">Loading saved workspaces…</p> : null}
      {dirty ? (
        <p className="pp-network-loading">Save or discard map edits before changing history.</p>
      ) : null}
      {!loading && workspaces.length === 0 ? <NetworkEmptyState /> : null}
      {workspaces.length ? (
        <div className="pp-history-layout">
          <nav aria-label="Saved network workspaces">
            {workspaces.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={candidate.id === activeID ? 'is-active' : ''}
                disabled={dirty && candidate.id !== activeID}
                onClick={() => onSelect(candidate.id)}
              >
                <strong>{candidate.name || candidate.id}</strong>
                <span>
                  {candidate.nodeCount} nodes · {candidate.snapshotCount} snapshots
                </span>
                <small>{new Date(candidate.updatedAt).toLocaleString()}</small>
              </button>
            ))}
          </nav>
          {workspace ? (
            <section className="pp-snapshot-timeline" aria-label={`${workspace.name} snapshots`}>
              <header>
                <div>
                  <h2>{workspace.name}</h2>
                  <p>{workspace.tags.join(' · ') || 'No workspace tags'}</p>
                </div>
                <button
                  type="button"
                  className={deleteConfirmation === workspace.id ? 'is-confirm' : ''}
                  disabled={dirty}
                  onClick={() => onDelete(workspace.id)}
                >
                  <Trash2 aria-hidden="true" />
                  {deleteConfirmation === workspace.id ? 'Confirm delete' : 'Delete'}
                </button>
              </header>
              {workspace.snapshots.map((snapshot, index) => (
                <article key={snapshot.id}>
                  <i aria-hidden="true" />
                  <div>
                    <small>Snapshot {String(index + 1).padStart(2, '0')}</small>
                    <strong>{snapshot.label}</strong>
                    <time dateTime={snapshot.observedAt}>
                      {new Date(snapshot.observedAt).toLocaleString()}
                    </time>
                    <p>
                      {snapshot.nodes.length} nodes · {snapshot.edges.length} logical edges ·{' '}
                      {snapshot.groups.length} groups
                    </p>
                    <button
                      type="button"
                      className={restoreConfirmation === snapshot.id ? 'is-confirm' : ''}
                      disabled={dirty}
                      onClick={() => onRestore(snapshot.id)}
                    >
                      {restoreConfirmation === snapshot.id
                        ? 'Confirm restore current map'
                        : 'Use as current map'}
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ExportActions({ onExport }: { onExport: (kind: 'json' | 'graphml' | 'csv') => void }) {
  return (
    <fieldset className="pp-network-export-actions">
      <legend className="sr-only">Export current network workspace</legend>
      <button type="button" title="Lossless canonical workspace" onClick={() => onExport('json')}>
        <FileJson aria-hidden="true" /> JSON
      </button>
      <button
        type="button"
        title={networkGraphMLExportLosses.join(' ')}
        onClick={() => onExport('graphml')}
      >
        <Network aria-hidden="true" /> GraphML
      </button>
      <button type="button" title="Current inventory only" onClick={() => onExport('csv')}>
        <Download aria-hidden="true" /> CSV
      </button>
    </fieldset>
  );
}

function NetworkEmptyState() {
  return (
    <div className="pp-network-empty">
      <MapIcon aria-hidden="true" />
      <h2>No saved network evidence</h2>
      <p>Trace a path, scan an authorized private CIDR, or import a bounded JSON/GraphML file.</p>
      <div>
        <Link className="pp-network-empty-action" to="/network/path">
          Trace a path
        </Link>
        <Link className="pp-network-empty-action" to="/network/local">
          Scan local network
        </Link>
      </div>
    </div>
  );
}

function uniqueTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ).slice(0, networkWorkspaceLimits.maxTags);
}

function manualGroupDetailError(kind: NetworkGroup['kind'], value: string) {
  const detail = value.trim();
  if (kind === 'custom') return '';
  const label = {
    subnet: 'CIDR',
    vlan: 'VLAN ID',
    site: 'Site code',
    region: 'Region code',
    custom: 'Code',
  }[kind];
  if (!detail) return `${label} is required.`;
  if (kind === 'subnet' && !validManualCIDR(detail)) {
    return 'CIDR must be an explicit IPv4 or IPv6 prefix, such as 10.20.0.0/24.';
  }
  if (kind === 'vlan') {
    const vlanID = Number(detail);
    if (!Number.isInteger(vlanID) || vlanID < 1 || vlanID > 4094) {
      return 'VLAN ID must be a whole number from 1 through 4094.';
    }
  }
  return '';
}

function validManualCIDR(value: string) {
  const separator = value.lastIndexOf('/');
  if (separator <= 0 || separator === value.length - 1) return false;
  const address = value.slice(0, separator);
  const prefixText = value.slice(separator + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  if (address.includes(':')) {
    if (prefix < 0 || prefix > 128 || address.includes('%')) return false;
    try {
      return new URL(`http://[${address}]/`).hostname.startsWith('[');
    } catch {
      return false;
    }
  }
  if (prefix < 0 || prefix > 32) return false;
  const octets = address.split('.');
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => /^\d{1,3}$/.test(octet) && String(Number(octet)) === octet && Number(octet) <= 255
    )
  );
}

function fileStem(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'protopeek-network'
  ).slice(0, 96);
}

function downloadText(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
