import { type ChangeEvent, useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  AssertionRule,
  EnvironmentPreset,
  RequestHistoryEntry,
  SavedCollection,
  WorkspaceTargetProfile,
} from '@/shared/types';
import {
  appStorageKeys,
  loadStoredWorkspaceSection,
  type StoredWorkspaceRecovery,
  safeParseJson,
  sanitizeAssertionForPersistence,
  serializeWorkspaceExport,
  storeValue,
  storeValuesAtomically,
  uid,
  validateWorkspaceImport,
  workspaceImportMaxBytes,
} from '@/shared/utils';
import {
  downloadFile,
  type OperationMessage,
  prepareWorkspaceStorageValue,
  prepareWorkspaceStorageWrites,
  remapImportedTargetIDs,
} from './model';

const defaultAssertions: AssertionRule[] = [
  {
    id: uid('assert'),
    name: 'Status is OK',
    kind: 'status',
    comparator: 'equals',
    target: '',
    value: 'OK',
  },
  {
    id: uid('assert'),
    name: 'Latency under 800ms',
    kind: 'latency_ms',
    comparator: 'lte',
    target: '',
    value: '800',
  },
];

type UseWorkspaceRecordsOptions = {
  setOperationMessage: React.Dispatch<React.SetStateAction<OperationMessage | null>>;
};

export function useWorkspaceRecords({ setOperationMessage }: UseWorkspaceRecordsOptions) {
  const [initialWorkspace] = useState(() => ({
    assertions: loadStoredWorkspaceSection(
      appStorageKeys.assertions,
      'assertions',
      defaultAssertions
    ),
    collections: loadStoredWorkspaceSection(appStorageKeys.collections, 'collections', []),
    environments: loadStoredWorkspaceSection(appStorageKeys.environments, 'environments', []),
    history: loadStoredWorkspaceSection(appStorageKeys.history, 'history', []),
    targets: loadStoredWorkspaceSection(appStorageKeys.targets, 'targets', []),
  }));
  const initialRecoveries = Object.values(initialWorkspace)
    .map((entry) => entry.recovery)
    .filter((entry): entry is StoredWorkspaceRecovery => entry !== null);
  const blockedStorageRef = useRef(new Set(initialRecoveries.map((recovery) => recovery.key)));
  const [recoveries, setRecoveries] = useState<StoredWorkspaceRecovery[]>(initialRecoveries);
  const [targets, setTargets] = useState<WorkspaceTargetProfile[]>(initialWorkspace.targets.value);
  const [collections, setCollections] = useState<SavedCollection[]>(
    initialWorkspace.collections.value
  );
  const [environments, setEnvironments] = useState<EnvironmentPreset[]>(
    initialWorkspace.environments.value
  );
  const [history, setHistory] = useState<RequestHistoryEntry[]>(initialWorkspace.history.value);
  const [assertionRules, setAssertionRules] = useState<AssertionRule[]>(
    initialWorkspace.assertions.value
  );

  function storeWorkspaceValue(key: string, value: unknown) {
    if (blockedStorageRef.current.has(key)) {
      return {
        ok: false as const,
        error:
          'Resolve the recovered workspace data before replacing this browser-storage section.',
      };
    }
    const prepared = prepareWorkspaceStorageValue(key, value);
    if (!prepared.ok) return prepared;
    return storeValue(key, prepared.value);
  }

  const persistWorkspaceEffect = useEffectEvent((key: string, value: unknown) => {
    if (blockedStorageRef.current.has(key)) return;
    const stored = storeWorkspaceValue(key, value);
    if (stored.ok) return;
    setOperationMessage((current) =>
      current?.tone === 'danger'
        ? current
        : {
            tone: 'danger',
            title: 'Workspace changes are session-only',
            description: `Workspace validation or browser storage refused the write: ${stored.error}`,
          }
    );
  });

  useEffect(() => {
    persistWorkspaceEffect(appStorageKeys.collections, collections);
  }, [collections]);
  useEffect(() => {
    persistWorkspaceEffect(appStorageKeys.environments, environments);
  }, [environments]);
  useEffect(() => {
    persistWorkspaceEffect(appStorageKeys.history, history);
  }, [history]);
  useEffect(() => {
    persistWorkspaceEffect(
      appStorageKeys.assertions,
      assertionRules.map(sanitizeAssertionForPersistence)
    );
  }, [assertionRules]);
  useEffect(() => {
    persistWorkspaceEffect(appStorageKeys.targets, targets);
  }, [targets]);

  function downloadRecovery() {
    downloadFile(
      'protopeek-storage-recovery.json',
      JSON.stringify(
        {
          format: 'protopeek-storage-recovery',
          exportedAt: new Date().toISOString(),
          warning:
            'This is a raw, non-importable recovery snapshot. Readable originals may contain credentials, request bodies, and host file paths. A null raw value means the browser refused the read and the original key was only left untouched.',
          sections: recoveries,
        },
        null,
        2
      ),
      'application/json'
    );
  }

  function useRecoveredWorkspace() {
    const values = new Map<string, unknown>([
      [appStorageKeys.assertions, assertionRules.map(sanitizeAssertionForPersistence)],
      [appStorageKeys.collections, collections],
      [appStorageKeys.environments, environments],
      [appStorageKeys.history, history],
      [appStorageKeys.targets, targets],
    ]);
    const writes = recoveries.map(
      (recovery) => [recovery.key, values.get(recovery.key) ?? []] as [string, unknown]
    );
    const prepared = prepareWorkspaceStorageWrites(writes);
    if (!prepared.ok) {
      setOperationMessage({
        tone: 'danger',
        title: 'Recovered workspace is not valid yet',
        description: prepared.error,
      });
      return;
    }
    const stored = storeValuesAtomically(prepared.values);
    if (!stored.ok) {
      setOperationMessage({
        tone: 'danger',
        title: 'Recovered workspace remains session-only',
        description: `Recovery remains unresolved. Browser storage reported: ${stored.error} Use the downloaded originals if rollback was incomplete.`,
      });
      return;
    }
    for (const recovery of recoveries) {
      blockedStorageRef.current.delete(recovery.key);
    }
    setRecoveries([]);
    setOperationMessage({
      tone: 'info',
      title: 'Recovered workspace accepted',
      description: 'Only the bounded valid records now remain in browser storage.',
    });
  }

  function exportWorkspace() {
    if (recoveries.length > 0) {
      setOperationMessage({
        tone: 'danger',
        title: 'Workspace export paused for recovery',
        description:
          'Download or accept the original browser-storage recovery before creating a normal importable workspace.',
      });
      return;
    }
    try {
      const content = serializeWorkspaceExport({
        assertions: assertionRules,
        collections,
        environments,
        targets,
      });
      downloadFile('protopeek-workspace.json', content, 'application/json');
      setOperationMessage({
        tone: 'info',
        title: 'Version 1 workspace exported',
        description:
          'Automatic RPC history was excluded. Saved request bodies are deliberate workspace data; review them before sharing the file.',
      });
    } catch (error) {
      setOperationMessage({
        tone: 'danger',
        title: 'Workspace export refused',
        description: error instanceof Error ? error.message : 'Workspace export failed.',
      });
    }
  }

  async function importWorkspace(
    event: ChangeEvent<HTMLInputElement>,
    beforeTargetsReplace: () => void
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > workspaceImportMaxBytes) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import refused',
          description: 'The file exceeds the 4 MiB workspace import limit.',
        });
        return;
      }
      const parsed = safeParseJson(await file.text());
      if (parsed.error) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import refused',
          description: `Invalid workspace JSON: ${parsed.error}`,
        });
        return;
      }
      const validated = validateWorkspaceImport(parsed.value);
      if (validated.error || !validated.value) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import refused',
          description: validated.error || 'Invalid workspace JSON.',
        });
        return;
      }
      const imported = remapImportedTargetIDs(validated.value, targets);
      const hasBrowserFolderProfiles = imported.targets.some(
        (target) => target.schemaSource === 'browser-proto-folder'
      );
      const writes: Array<[string, unknown]> = [];
      if (imported.sections.assertions)
        writes.push([appStorageKeys.assertions, imported.assertions]);
      if (imported.sections.collections)
        writes.push([appStorageKeys.collections, imported.collections]);
      if (imported.sections.environments) {
        writes.push([appStorageKeys.environments, imported.environments]);
      }
      if (imported.sections.history) writes.push([appStorageKeys.history, imported.history ?? []]);
      if (imported.sections.targets) writes.push([appStorageKeys.targets, imported.targets]);
      const blockedImport = writes.find(([key]) => blockedStorageRef.current.has(key));
      if (blockedImport) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import paused for recovery',
          description:
            'Download or accept the original browser-storage recovery before replacing an affected section.',
        });
        return;
      }
      const prepared = prepareWorkspaceStorageWrites(writes);
      if (!prepared.ok) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import refused',
          description: prepared.error,
        });
        return;
      }
      const stored = storeValuesAtomically(prepared.values);
      if (!stored.ok) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace was not imported',
          description: `Browser storage failed: ${stored.error}`,
        });
        return;
      }

      if (imported.sections.assertions) setAssertionRules(imported.assertions);
      if (imported.sections.collections) setCollections(imported.collections);
      if (imported.sections.environments) setEnvironments(imported.environments);
      if (imported.sections.history) setHistory(imported.history ?? []);
      if (imported.sections.targets) {
        beforeTargetsReplace();
        setTargets(imported.targets);
      }
      setOperationMessage({
        tone: 'info',
        title: imported.legacy ? 'Legacy workspace imported safely' : 'Workspace imported',
        description: `${
          imported.hasHostFilePaths
            ? 'No target was connected. Imported proto, protoset, certificate, and key paths refer to paths on the ProtoPeek host; connecting that target grants the ProtoPeek process local file-read authority for those paths.'
            : 'No target was connected. Imported targets remain inactive until you explicitly connect one.'
        }${
          hasBrowserFolderProfiles
            ? ' Browser-folder profiles include no schema snapshot bytes, folder handle, root name, or local path. They show Folder required and must be repicked before connecting.'
            : ''
        }`,
      });
    } catch (error) {
      setOperationMessage({
        tone: 'danger',
        title: 'Workspace import refused',
        description: error instanceof Error ? error.message : 'Workspace import failed.',
      });
    } finally {
      input.value = '';
    }
  }

  return {
    assertionRules,
    collections,
    history,
    recoveries,
    targets,
    setAssertionRules,
    setCollections,
    setHistory,
    setTargets,
    downloadRecovery,
    exportWorkspace,
    importWorkspace,
    storeWorkspaceValue,
    useRecoveredWorkspace,
  };
}
