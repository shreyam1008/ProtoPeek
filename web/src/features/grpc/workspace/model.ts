import type { WorkspaceTargetConfig, WorkspaceTargetProfile } from '@/shared/types';
import {
  appStorageKeys,
  toWorkspaceTargetProfile,
  uid,
  validateWorkspaceImport,
  workspaceTargetReferenceError,
} from '@/shared/utils';

export type OperationMessage = {
  tone: 'danger' | 'info';
  title: string;
  description: string;
  actions?: Array<{ label: string; run: () => void }>;
};

type WorkspaceStorageSection =
  | 'assertions'
  | 'collections'
  | 'environments'
  | 'history'
  | 'targets';

const workspaceSectionByStorageKey = new Map<string, WorkspaceStorageSection>([
  [appStorageKeys.assertions, 'assertions'],
  [appStorageKeys.collections, 'collections'],
  [appStorageKeys.environments, 'environments'],
  [appStorageKeys.history, 'history'],
  [appStorageKeys.targets, 'targets'],
]);

export function prepareWorkspaceStorageValue(key: string, value: unknown) {
  const section = workspaceSectionByStorageKey.get(key);
  if (!section) {
    return { ok: false as const, error: 'Unknown workspace storage section.' };
  }
  const validated = validateWorkspaceImport({ [section]: value });
  if (validated.error || !validated.value) {
    return {
      ok: false as const,
      error: validated.error || `Invalid ${section} workspace data.`,
    };
  }
  return { ok: true as const, value: validated.value[section] ?? [] };
}

export function prepareWorkspaceStorageWrites(entries: Array<[string, unknown]>) {
  const values: Array<[string, unknown]> = [];
  for (const [key, value] of entries) {
    const prepared = prepareWorkspaceStorageValue(key, value);
    if (!prepared.ok) return prepared;
    values.push([key, prepared.value]);
  }
  return { ok: true as const, values };
}

export function newTargetDraft(defaults?: WorkspaceTargetConfig): WorkspaceTargetProfile {
  return toWorkspaceTargetProfile({
    name: '',
    notes: '',
    config: {
      address: defaults?.address?.trim() || 'localhost:50051',
      plaintext: defaults?.plaintext ?? true,
      insecure: defaults?.insecure ?? false,
      authority: defaults?.authority ?? '',
      cacertPath: defaults?.cacertPath ?? '',
      certPath: defaults?.certPath ?? '',
      keyPath: defaults?.keyPath ?? '',
      schemaSource: defaults?.schemaSource ?? 'reflection',
      protoFiles: defaults?.protoFiles ?? [],
      importPaths: defaults?.importPaths ?? [],
      protosets: defaults?.protosets ?? [],
    },
  });
}

function targetIdentity(target: WorkspaceTargetProfile) {
  return JSON.stringify([
    target.address.trim(),
    target.plaintext,
    target.insecure,
    target.authority.trim(),
    target.cacertPath.trim(),
    target.certPath.trim(),
    target.keyPath.trim(),
    target.schemaSource,
    target.protoFiles,
    target.importPaths,
    target.protosets,
  ]);
}

export function reuseExistingTargetID(
  candidate: WorkspaceTargetProfile,
  existingTargets: WorkspaceTargetProfile[]
) {
  const existing = existingTargets.find(
    (target) => target.id !== candidate.id && targetIdentity(target) === targetIdentity(candidate)
  );
  return existing ? { ...candidate, id: existing.id } : candidate;
}

export function materializeTarget(target: WorkspaceTargetProfile) {
  const browserFolderSource = target.schemaSource === 'browser-proto-folder';
  return toWorkspaceTargetProfile({
    id: target.id,
    name: target.name.trim() || target.address || 'Untitled',
    notes: target.notes,
    config: {
      address: target.address.trim(),
      plaintext: target.plaintext,
      insecure: target.insecure,
      authority: target.authority.trim(),
      cacertPath: target.cacertPath.trim(),
      certPath: target.certPath.trim(),
      keyPath: target.keyPath.trim(),
      schemaSource: target.schemaSource,
      protoFiles: browserFolderSource ? [] : target.protoFiles,
      importPaths: browserFolderSource ? [] : target.importPaths,
      protosets: browserFolderSource ? [] : target.protosets,
    },
  });
}

export function parseMultilineValues(value: string) {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function remapImportedTargetIDs(
  data: NonNullable<ReturnType<typeof validateWorkspaceImport>['value']>,
  currentTargets: WorkspaceTargetProfile[]
) {
  const referenceError = workspaceTargetReferenceError(
    [...data.collections, ...(data.history ?? [])],
    data.sections.targets ? data.targets : currentTargets
  );
  if (referenceError) throw new Error(referenceError);
  const targetIDs = new Map<string, string>();
  const importedTargetsByID = new Map<string, WorkspaceTargetProfile>();
  const targets = data.targets.map((target) => {
    const nextID = uid('target');
    targetIDs.set(target.id.trim(), nextID);
    importedTargetsByID.set(target.id.trim(), target);
    return { ...target, id: nextID };
  });
  const currentTargetsByID = new Map(currentTargets.map((target) => [target.id.trim(), target]));
  const remapScope = <T extends { targetId?: string; targetAddress?: string }>(entry: T): T => {
    const targetId = entry.targetId?.trim();
    const targetAddress = entry.targetAddress?.trim() || undefined;
    if (!targetId) return { ...entry, targetId: undefined, targetAddress };
    if (targetIDs.has(targetId)) {
      const target = importedTargetsByID.get(targetId);
      if (targetAddress && target && targetAddress !== target.address.trim()) {
        throw new Error(`Saved request target address conflicts with profile ${targetId}.`);
      }
      return { ...entry, targetId: targetIDs.get(targetId), targetAddress };
    }
    if (!data.sections.targets && currentTargetsByID.has(targetId)) {
      const target = currentTargetsByID.get(targetId);
      if (targetAddress && target && targetAddress !== target.address.trim()) {
        throw new Error(`Saved request target address conflicts with profile ${targetId}.`);
      }
      return { ...entry, targetId, targetAddress };
    }
    if (!targetAddress) {
      throw new Error(
        `Saved request target ${targetId} is not present and has no address fallback.`
      );
    }
    return { ...entry, targetId, targetAddress };
  };
  return {
    ...data,
    targets,
    collections: data.collections.map(remapScope),
    history: data.history?.map(remapScope),
  };
}

export function downloadFile(name: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
