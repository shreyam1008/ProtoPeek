import { useNavigate } from '@tanstack/react-router';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';

import {
  exportNetworkGraphML,
  exportNetworkInventoryCSV,
  importNetworkGraphML,
  type NetworkGraphMLImportResult,
  type NetworkSnapshot,
  type NetworkWorkspaceV1,
  networkWorkspaceLimits,
  parseNetworkWorkspaceJSON,
  serializeNetworkWorkspace,
} from '@/console/network-model';
import type { PathTrace } from '@/console/network-path';
import {
  NetworkStore,
  type NetworkStoreHealth,
  type NetworkStoreMetadata,
} from '@/console/network-store';
import {
  appendNetworkObservation,
  createWorkspaceFromSnapshot,
  restoreNetworkSnapshot,
} from '@/console/network-workspace';
import { pathTraceToNetworkWorkspace } from '@/console/path-to-network';

type ControllerOperation = { generation: number; editRevision: number };

const defaultNetworkStore = new NetworkStore();

export function useNetworkWorkspace(store: NetworkStore = defaultNetworkStore) {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<readonly NetworkStoreMetadata[]>([]);
  const [activeID, setActiveID] = useState('');
  const [workspace, setWorkspace] = useState<NetworkWorkspaceV1 | null>(null);
  const [health, setHealth] = useState<NetworkStoreHealth | null>(null);
  const [loadingStore, setLoadingStore] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [restoreConfirmation, setRestoreConfirmation] = useState('');
  const activeIDRef = useRef('');
  const dirtyRef = useRef(false);
  const persistedWorkspaceRef = useRef<NetworkWorkspaceV1 | null>(null);
  const editRevisionRef = useRef(0);
  const operationGenerationRef = useRef(0);
  const controllerOperationRef = useRef<ControllerOperation | null>(null);
  const mountedRef = useRef(false);

  const claimControllerOperation = useCallback(() => {
    const operation = {
      generation: operationGenerationRef.current + 1,
      editRevision: editRevisionRef.current,
    };
    operationGenerationRef.current = operation.generation;
    controllerOperationRef.current = operation;
    return operation;
  }, []);

  const operationOwnsController = useCallback(
    (operation: ControllerOperation) =>
      mountedRef.current &&
      controllerOperationRef.current === operation &&
      operationGenerationRef.current === operation.generation,
    []
  );

  const operationIsCurrent = useCallback(
    (operation: ControllerOperation) =>
      operationOwnsController(operation) && editRevisionRef.current === operation.editRevision,
    [operationOwnsController]
  );

  const operationHasNewerEdit = useCallback(
    (operation: ControllerOperation) =>
      operationOwnsController(operation) && editRevisionRef.current !== operation.editRevision,
    [operationOwnsController]
  );

  const commitWorkspaceView = useCallback(
    (
      operation: ControllerOperation,
      nextWorkspace: NetworkWorkspaceV1 | null,
      nextActiveID: string,
      nextDirty: boolean
    ) => {
      if (!operationIsCurrent(operation)) return false;
      activeIDRef.current = nextActiveID;
      dirtyRef.current = nextDirty;
      if (!nextDirty) persistedWorkspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
      setActiveID(nextActiveID);
      setDirty(nextDirty);
      setLoadingStore(false);
      return true;
    },
    [operationIsCurrent]
  );

  function editWorkspace(next: NetworkWorkspaceV1) {
    editRevisionRef.current += 1;
    dirtyRef.current = true;
    setWorkspace(next);
    setDirty(true);
  }

  useEffect(() => {
    let effectMounted = true;
    mountedRef.current = true;
    const operation = claimControllerOperation();
    void (async () => {
      try {
        const initialized = await store.initialize();
        if (!operationIsCurrent(operation)) return;
        const listed = await store.list();
        if (!operationIsCurrent(operation)) return;
        setHealth(initialized.mode === 'session-only' ? initialized : listed.health);
        if (listed.error !== null) {
          setNotice(listed.error.message);
          return;
        }
        setWorkspaces(listed.value);
        const first = listed.value[0];
        if (first) {
          const loaded = await store.get(first.id);
          if (!operationIsCurrent(operation)) return;
          if (loaded.error !== null) setNotice(loaded.error.message);
          else if (loaded.value) {
            commitWorkspaceView(operation, loaded.value, first.id, false);
          } else {
            setNotice(`Saved workspace ${first.id} was not found.`);
          }
        }
      } finally {
        if (effectMounted) setLoadingStore(false);
      }
    })();
    return () => {
      effectMounted = false;
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      controllerOperationRef.current = null;
    };
  }, [store, claimControllerOperation, commitWorkspaceView, operationIsCurrent]);

  async function loadWorkspace(operation: ControllerOperation, id: string) {
    const loaded = await store.get(id);
    if (!operationIsCurrent(operation)) return false;
    setHealth(loaded.health);
    if (loaded.error !== null) {
      setNotice(loaded.error.message);
      return false;
    }
    if (!loaded.value) {
      setNotice(`Saved workspace ${id} was not found.`);
      return false;
    }
    commitWorkspaceView(operation, loaded.value, id, false);
    setDeleteConfirmation('');
    setRestoreConfirmation('');
    return true;
  }

  async function refreshMetadata(
    operation: ControllerOperation,
    preferredID = activeIDRef.current
  ) {
    const listed = await store.list();
    if (!operationIsCurrent(operation)) return false;
    setHealth(listed.health);
    if (listed.error !== null) {
      setNotice(listed.error.message);
      return false;
    }
    setWorkspaces(listed.value);
    if (preferredID && listed.value.some(({ id }) => id === preferredID)) return true;
    const first = listed.value[0];
    if (!first) {
      commitWorkspaceView(operation, null, '', false);
      return true;
    }
    return loadWorkspace(operation, first.id);
  }

  async function selectWorkspace(id: string, force = false) {
    if (!force && dirtyRef.current && id !== activeIDRef.current) {
      setNotice('Save or discard the current map edits before switching workspaces.');
      return false;
    }
    const operation = claimControllerOperation();
    return loadWorkspace(operation, id);
  }

  async function persistWorkspace(
    next: NetworkWorkspaceV1,
    successMessage: string,
    operation: ControllerOperation,
    options: {
      expectedPrevious: NetworkWorkspaceV1 | null;
      protectConcurrentEdits?: boolean;
    }
  ) {
    const startingActiveID = activeIDRef.current;
    const hasNewerSameWorkspaceEdit = () =>
      options.protectConcurrentEdits &&
      next.id === startingActiveID &&
      activeIDRef.current === startingActiveID &&
      operationHasNewerEdit(operation);
    const saved = await store.put(next, { expectedPrevious: options.expectedPrevious });
    if (!operationOwnsController(operation)) return false;
    setHealth(saved.health);
    if (saved.error !== null) {
      if (operationHasNewerEdit(operation)) {
        setNotice(`${saved.error.message} Newer edits remain unsaved.`);
      } else {
        setNotice(saved.error.message);
      }
      return false;
    }
    if (hasNewerSameWorkspaceEdit()) {
      persistedWorkspaceRef.current = next;
      setNotice(`${successMessage} Newer edits remain unsaved.`);
      return false;
    }
    if (operationHasNewerEdit(operation)) {
      setNotice(`${successMessage} Newer edits remain unsaved.`);
      return false;
    }
    if (!operationIsCurrent(operation)) return false;
    if (!commitWorkspaceView(operation, next, next.id, false)) return false;
    if (!(await refreshMetadata(operation, next.id))) {
      if (operationHasNewerEdit(operation)) {
        setNotice(`${successMessage} Newer edits remain unsaved.`);
      }
      return false;
    }
    if (!operationIsCurrent(operation)) return false;
    setNotice(successMessage);
    return true;
  }

  async function findWorkspace(
    operation: ControllerOperation,
    predicate: (candidate: NetworkWorkspaceV1) => boolean
  ): Promise<NetworkWorkspaceV1 | null> {
    if (!operationIsCurrent(operation)) return null;
    if (workspace && predicate(workspace)) return workspace;
    for (const candidate of workspaces) {
      if (candidate.id === workspace?.id) continue;
      const loaded = await store.get(candidate.id);
      if (!operationIsCurrent(operation)) return null;
      if (loaded.error === null && loaded.value && predicate(loaded.value)) return loaded.value;
    }
    return null;
  }

  async function savePathTrace(trace: PathTrace) {
    if (dirtyRef.current) {
      setNotice('Save or discard the current map edits before saving a new path observation.');
      return false;
    }
    const operation = claimControllerOperation();
    try {
      const observation = pathTraceToNetworkWorkspace(trace, { tags: ['path-trace'] });
      const current = await findWorkspace(
        operation,
        (candidate) => candidate.tags.includes('path-trace') && candidate.name === observation.name
      );
      if (!operationIsCurrent(operation)) return false;
      const next = current ? appendNetworkObservation(current, observation) : observation;
      return await persistWorkspace(
        next,
        current
          ? `Appended a new immutable path snapshot to ${next.name}.`
          : `Saved ${next.name} as a network workspace.`,
        operation,
        { expectedPrevious: current }
      );
    } catch (error) {
      if (!operationIsCurrent(operation)) return false;
      setNotice(error instanceof Error ? error.message : 'Path evidence could not be saved.');
      return false;
    }
  }

  async function saveLocalSnapshot(snapshot: NetworkSnapshot) {
    if (dirtyRef.current) {
      setNotice('Save or discard the current map edits before saving a new network snapshot.');
      return false;
    }
    const operation = claimControllerOperation();
    try {
      const observation = createWorkspaceFromSnapshot(snapshot);
      const scope = snapshot.groups.find((group) => group.kind === 'subnet')?.cidr ?? '';
      const current = scope
        ? await findWorkspace(
            operation,
            (candidate) =>
              candidate.tags.includes('local-network') &&
              candidate.groups.some((group) => group.kind === 'subnet' && group.cidr === scope)
          )
        : null;
      if (!operationIsCurrent(operation)) return false;
      const next = current ? appendNetworkObservation(current, observation) : observation;
      return await persistWorkspace(
        next,
        current
          ? `Appended a new immutable ${scope} snapshot.`
          : `Saved ${snapshot.label} as a network workspace.`,
        operation,
        { expectedPrevious: current }
      );
    } catch (error) {
      if (!operationIsCurrent(operation)) return false;
      setNotice(error instanceof Error ? error.message : 'Network snapshot could not be saved.');
      return false;
    }
  }

  async function saveEdits() {
    if (!workspace) return;
    const operation = claimControllerOperation();
    return persistWorkspace(workspace, `Saved edits to ${workspace.name}.`, operation, {
      expectedPrevious: persistedWorkspaceRef.current,
      protectConcurrentEdits: true,
    });
  }

  async function discardEdits() {
    const id = activeIDRef.current;
    if (!id) return;
    const operation = claimControllerOperation();
    if ((await loadWorkspace(operation, id)) && operationIsCurrent(operation)) {
      setNotice('Discarded unsaved map edits.');
    }
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
    const operation = claimControllerOperation();
    setRestoreConfirmation('');
    try {
      const restored = restoreNetworkSnapshot(workspace, snapshotID);
      if (
        await persistWorkspace(restored, 'Restored the snapshot as the current map.', operation, {
          expectedPrevious: workspace,
        })
      ) {
        if (operationIsCurrent(operation)) void navigate({ to: '/network/map' });
      }
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
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
    const operation = claimControllerOperation();
    const deleted = await store.delete(id);
    if (!operationOwnsController(operation)) return;
    setHealth(deleted.health);
    if (operationHasNewerEdit(operation)) {
      if (deleted.error === null) {
        setDeleteConfirmation('');
        setNotice(
          'Workspace removed from this browser profile. This cannot be undone here. Newer edits remain unsaved.'
        );
      } else {
        setNotice(`${deleted.error.message} Newer edits remain unsaved.`);
      }
      return;
    }
    if (deleted.error !== null) {
      setNotice(deleted.error.message);
      return;
    }
    setDeleteConfirmation('');
    if (activeIDRef.current === id) {
      commitWorkspaceView(operation, null, '', false);
    }
    if (!(await refreshMetadata(operation, ''))) {
      if (operationHasNewerEdit(operation)) {
        setNotice(
          'Workspace removed from this browser profile. This cannot be undone here. Newer edits remain unsaved.'
        );
      }
      return;
    }
    if (!operationIsCurrent(operation)) return;
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
    const operation = claimControllerOperation();
    try {
      const content = await file.text();
      if (!operationIsCurrent(operation)) return;
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
        operation,
        { expectedPrevious: null }
      );
      if (saved && operationIsCurrent(operation)) void navigate({ to: '/network/map' });
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
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

  return {
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
  };
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
