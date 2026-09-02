import { startTransition, useRef, useState } from 'react';
import type { WorkbenchView } from '@/console/ServiceNavigator';
import type {
  AssertionRule,
  BootstrapMethod,
  BootstrapResponse,
  BootstrapService,
  MetadataEntry,
  RequestHistoryEntry,
  SavedCollection,
  SchemaResponse,
  WorkspaceTargetProfile,
} from '@/shared/types';
import {
  appStorageKeys,
  generateRequestTemplate,
  prepareMetadataForReplay,
  prettyJson,
  redactedValue,
  toCollection,
  uid,
  validateWorkspaceImport,
  workspaceImportLimits,
} from '@/shared/utils';
import type { OperationMessage } from './model';

export type PendingReplayDraft = {
  method: string;
  metadata: MetadataEntry[];
  timeoutSeconds: number;
  requestText: string;
  redactedCount: number;
  legacyScope: boolean;
  migrationError?: string;
};

type UseGrpcReplayOptions = {
  bootstrap: BootstrapResponse | null;
  schema: SchemaResponse | null;
  selectedMethod: string;
  currentService: BootstrapService | null;
  currentMethod: BootstrapMethod | null;
  replayScope: { targetId?: string; targetAddress: string };
  targets: WorkspaceTargetProfile[];
  workspaceSessionId: string;
  requestText: string;
  metadata: MetadataEntry[];
  timeoutSeconds: number;
  assertionRules: AssertionRule[];
  collections: SavedCollection[];
  history: RequestHistoryEntry[];
  setRequestText: React.Dispatch<React.SetStateAction<string>>;
  setMetadata: React.Dispatch<React.SetStateAction<MetadataEntry[]>>;
  setTimeoutSeconds: React.Dispatch<React.SetStateAction<number>>;
  setAssertionRules: React.Dispatch<React.SetStateAction<AssertionRule[]>>;
  setCollections: React.Dispatch<React.SetStateAction<SavedCollection[]>>;
  setHistory: React.Dispatch<React.SetStateAction<RequestHistoryEntry[]>>;
  setSelectedMethod: React.Dispatch<React.SetStateAction<string>>;
  setActiveView: React.Dispatch<React.SetStateAction<WorkbenchView>>;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setOperationMessage: React.Dispatch<React.SetStateAction<OperationMessage | null>>;
  storeWorkspaceValue: (
    key: string,
    value: unknown
  ) => { ok: true; value?: unknown } | { ok: false; error: string };
  cancelHealthForContext: () => void;
  invalidateRepeat: () => void;
  cancelInvokeSilently: () => void;
  resetInvoke: () => void;
  clearInvokeResult: () => void;
};

export function useGrpcReplay(options: UseGrpcReplayOptions) {
  const {
    bootstrap,
    schema,
    selectedMethod,
    currentService,
    currentMethod,
    replayScope,
    targets,
    workspaceSessionId,
    requestText,
    metadata,
    timeoutSeconds,
    assertionRules,
    collections,
    history,
    setRequestText,
    setMetadata,
    setTimeoutSeconds,
    setAssertionRules,
    setCollections,
    setHistory,
    setSelectedMethod,
    setActiveView,
    setSidebarOpen,
    setOperationMessage,
    storeWorkspaceValue,
    cancelHealthForContext,
    invalidateRepeat,
    cancelInvokeSilently,
    resetInvoke,
    clearInvokeResult,
  } = options;
  const [collectionName, setCollectionName] = useState('');
  const [collectionNotes, setCollectionNotes] = useState('');
  const pendingDraftRef = useRef<PendingReplayDraft | null>(null);

  function saveCollection() {
    if (!currentService || !currentMethod) return;
    const collection = toCollection({
      name: collectionName.trim() || `${currentMethod.name} snapshot`,
      notes: collectionNotes,
      service: currentService.name,
      method: currentMethod.fullName,
      metadata,
      timeoutSeconds,
      requestText,
      ...replayScope,
    });
    const valid = validateWorkspaceImport({ collections: [collection] });
    if (valid.error) {
      setOperationMessage({
        tone: 'danger',
        title: 'Request was not saved',
        description: valid.error,
      });
      return;
    }
    const next = [collection, ...collections.filter((entry) => entry.id !== collection.id)];
    const stored = storeWorkspaceValue(appStorageKeys.collections, next);
    if (!stored.ok) {
      setOperationMessage({
        tone: 'danger',
        title: 'Request was not saved',
        description: `The request could not be persisted: ${stored.error}`,
      });
      return;
    }
    setCollections(next);
    setCollectionName('');
    setCollectionNotes('');
    const redactedCount = collection.metadata.filter(
      (entry) => entry.value === redactedValue
    ).length;
    setOperationMessage({
      tone: 'info',
      title: 'Request saved locally',
      description: redactedCount
        ? `${redactedCount} sensitive metadata ${redactedCount === 1 ? 'value was' : 'values were'} redacted and must be re-entered on replay.`
        : 'The request is scoped to the current target/profile.',
    });
  }

  function prepareReplay(entry: SavedCollection | RequestHistoryEntry) {
    const methodAvailable = bootstrap?.services.some((service) =>
      service.methods.some((method) => method.fullName === entry.method)
    );
    if (!methodAvailable) {
      pendingDraftRef.current = null;
      setOperationMessage({
        tone: 'danger',
        title: 'Replay refused',
        description: `${entry.method} is not available on the current target. The active request was not changed.`,
      });
      return null;
    }

    const storedTargetId = entry.targetId?.trim() || '';
    const storedTargetAddress = entry.targetAddress?.trim() || '';
    const currentTargetId = replayScope.targetId?.trim() || '';
    const scoped = Boolean(storedTargetId || storedTargetAddress);
    const storedProfileExists = Boolean(
      storedTargetId && targets.some((target) => target.id === storedTargetId)
    );
    const wrongAddress = Boolean(
      storedTargetAddress && storedTargetAddress !== replayScope.targetAddress
    );
    const wrongExistingProfile = Boolean(
      storedTargetId && storedProfileExists && storedTargetId !== currentTargetId
    );
    const orphanedProfile = Boolean(
      storedTargetId &&
        !storedProfileExists &&
        (!storedTargetAddress || currentTargetId || workspaceSessionId || wrongAddress)
    );
    if (scoped && (wrongExistingProfile || orphanedProfile || wrongAddress)) {
      pendingDraftRef.current = null;
      setOperationMessage({
        tone: 'danger',
        title: 'Replay refused',
        description: orphanedProfile
          ? 'The saved target profile is unavailable. Restore that profile or use an address-scoped direct session; the active request was not changed.'
          : 'This record belongs to a different target/profile. Connect that target before applying it; the active request was not changed.',
      });
      return null;
    }

    const restored = prepareMetadataForReplay(entry.metadata);
    return {
      method: entry.method,
      metadata: restored.metadata,
      timeoutSeconds: entry.timeoutSeconds,
      requestText: entry.requestText,
      redactedCount: restored.redactedCount,
      legacyScope: !scoped,
      migrationError: undefined as string | undefined,
    };
  }

  function applyReplayDraft(draft: NonNullable<ReturnType<typeof prepareReplay>>) {
    if (draft.method !== selectedMethod) cancelHealthForContext();
    invalidateRepeat();
    cancelInvokeSilently();
    resetInvoke();
    if (draft.method === selectedMethod) {
      pendingDraftRef.current = null;
      setRequestText(draft.requestText);
      setMetadata(draft.metadata);
      setTimeoutSeconds(draft.timeoutSeconds);
      if (draft.migrationError) {
        setOperationMessage({
          tone: 'danger',
          title: 'Legacy replay was not migrated',
          description: draft.migrationError,
        });
      } else if (draft.redactedCount > 0) {
        setOperationMessage({
          tone: 'info',
          title: 'Sensitive metadata omitted',
          description: `${draft.redactedCount} redacted metadata ${draft.redactedCount === 1 ? 'value was' : 'values were'} left blank. Re-enter before invoking; blank or [redacted] sensitive values are never sent.${draft.legacyScope ? ' This legacy record is now scoped to the current target.' : ''}`,
        });
      } else if (draft.legacyScope) {
        setOperationMessage({
          tone: 'info',
          title: 'Legacy replay scoped',
          description:
            'This unscoped legacy record was applied to an available method and is now bound to the current target/profile.',
        });
      } else {
        setOperationMessage(null);
      }
      setActiveView('compose');
      return;
    }
    pendingDraftRef.current = draft;
    startTransition(() => {
      setSelectedMethod(draft.method);
      setActiveView('compose');
    });
  }

  function applyCollection(collection: SavedCollection) {
    const draft = prepareReplay(collection);
    if (!draft) return;
    setCollectionName(collection.name);
    setCollectionNotes(collection.notes);
    if (draft.legacyScope) {
      const migrated = { ...collection, ...replayScope };
      const next = collections.map((entry) => (entry.id === collection.id ? migrated : entry));
      const stored = storeWorkspaceValue(appStorageKeys.collections, next);
      if (!stored.ok) {
        draft.migrationError = `The request was loaded safely for this session, but browser storage failed: ${stored.error}`;
      } else {
        setCollections(next);
      }
    }
    applyReplayDraft(draft);
  }

  function applyHistory(entry: RequestHistoryEntry) {
    const draft = prepareReplay(entry);
    if (!draft) return;
    if (draft.legacyScope) {
      const migrated = { ...entry, ...replayScope };
      const next = history.map((item) => (item.id === entry.id ? migrated : item));
      const stored = storeWorkspaceValue(appStorageKeys.history, next);
      if (!stored.ok) {
        draft.migrationError = `The request was loaded safely for this session, but browser storage failed: ${stored.error}`;
      } else {
        setHistory(next);
      }
    }
    applyReplayDraft(draft);
  }

  function resetRequestFromSchema() {
    if (!schema) return;
    setRequestText(prettyJson(generateRequestTemplate(schema)));
  }

  function selectMethod(method: string) {
    cancelHealthForContext();
    invalidateRepeat();
    cancelInvokeSilently();
    pendingDraftRef.current = null;
    setOperationMessage(null);
    clearInvokeResult();
    startTransition(() => {
      setSelectedMethod(method);
      setActiveView('compose');
      setSidebarOpen(false);
    });
  }

  function changeAssertion(id: string, next: AssertionRule) {
    setAssertionRules((current) => current.map((rule) => (rule.id === id ? next : rule)));
  }

  function addAssertion() {
    if (assertionRules.length >= workspaceImportLimits.assertions) {
      setOperationMessage({
        tone: 'danger',
        title: 'Assertion limit reached',
        description: `A workspace can keep at most ${workspaceImportLimits.assertions} assertions.`,
      });
      return;
    }
    setAssertionRules((current) => [
      ...current,
      {
        id: uid('assert'),
        name: 'Response count >= 1',
        kind: 'response_count',
        comparator: 'gte',
        target: '',
        value: '1',
      },
    ]);
  }

  function removeAssertion(id: string) {
    setAssertionRules((current) => current.filter((rule) => rule.id !== id));
  }

  return {
    pendingDraftRef,
    addAssertion,
    applyCollection,
    applyHistory,
    changeAssertion,
    removeAssertion,
    resetRequestFromSchema,
    saveCollection,
    selectMethod,
  };
}
