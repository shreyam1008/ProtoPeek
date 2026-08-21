import {
  type NetworkWorkspaceV1,
  networkWorkspaceLimits,
  parseNetworkWorkspaceJSON,
  serializeNetworkWorkspace,
} from './network-model';

export const networkStoreConfiguration = {
  databaseName: 'protopeek-network',
  databaseVersion: 1,
  objectStoreName: 'workspaces',
} as const;

export const networkStoreLimits = {
  maxWorkspaces: 20,
  maxWorkspaceBytes: networkWorkspaceLimits.maxJSONBytes,
  maxStoredBytes: 32 << 20,
} as const;

export type NetworkStoreConfiguration = typeof networkStoreConfiguration;

export type NetworkStorePersistenceConnection = {
  read(maxRecords: number): Promise<{
    readonly values: readonly unknown[];
    readonly overflow: boolean;
  }>;
  put(value: unknown, expectedWorkspaceJSON: string | null): Promise<boolean>;
  delete(id: string, expectedWorkspaceJSON: string): Promise<boolean>;
  close?(): void;
};

export type NetworkStorePersistence = {
  open(configuration: NetworkStoreConfiguration): Promise<NetworkStorePersistenceConnection>;
};

export type NetworkStoreHealth =
  | {
      readonly mode: 'persistent';
      readonly reason: null;
      readonly error: null;
      readonly quarantinedRecords: 0;
    }
  | {
      readonly mode: 'session-only';
      readonly reason: 'unavailable' | 'denied' | 'quota' | 'corrupt';
      readonly error: string;
      readonly quarantinedRecords: number;
    };

export type NetworkStoreMetadata = {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly groupCount: number;
  readonly snapshotCount: number;
  readonly bytes: number;
};

export type NetworkStoreError = {
  readonly code: 'validation' | 'capacity' | 'conflict' | 'persistence';
  readonly message: string;
};

export type NetworkStorePutOptions = {
  readonly expectedPrevious: NetworkWorkspaceV1 | null;
};

export type NetworkStoreResult<T> =
  | { readonly error: null; readonly value: T; readonly health: NetworkStoreHealth }
  | {
      readonly error: NetworkStoreError;
      readonly value: null;
      readonly health: NetworkStoreHealth;
    };

type StoredNetworkWorkspace = {
  readonly recordFormat: 'protopeek-network-workspace';
  readonly recordVersion: 1;
  readonly id: string;
  readonly bytes: number;
  readonly workspaceJSON: string;
};

type SessionEntry = {
  readonly record: StoredNetworkWorkspace;
  readonly workspace: NetworkWorkspaceV1;
  readonly metadata: NetworkStoreMetadata;
};

const persistentHealth: NetworkStoreHealth = {
  mode: 'persistent',
  reason: null,
  error: null,
  quarantinedRecords: 0,
};

const utf8 = new TextEncoder();

class NetworkStoreFailure extends Error {
  constructor(
    readonly code: NetworkStoreError['code'],
    message: string
  ) {
    super(message);
  }
}

function metadata(workspace: NetworkWorkspaceV1, bytes: number): NetworkStoreMetadata {
  return Object.freeze({
    id: workspace.id,
    name: workspace.name,
    tags: Object.freeze([...workspace.tags]),
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    nodeCount: workspace.nodes.length,
    edgeCount: workspace.edges.length,
    groupCount: workspace.groups.length,
    snapshotCount: workspace.snapshots.length,
    bytes,
  });
}

function prepareEntry(workspace: unknown): SessionEntry {
  let workspaceJSON: string;
  try {
    workspaceJSON = serializeNetworkWorkspace(workspace as NetworkWorkspaceV1);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network workspace is invalid.';
    if (/file exceeds/i.test(message)) throw new NetworkStoreFailure('capacity', message);
    throw new NetworkStoreFailure('validation', message);
  }
  const bytes = utf8.encode(workspaceJSON).byteLength;
  if (bytes > networkStoreLimits.maxWorkspaceBytes) {
    throw new NetworkStoreFailure(
      'capacity',
      'Network workspace exceeds the 4 MiB serialized storage limit.'
    );
  }
  const parsed = parseNetworkWorkspaceJSON(workspaceJSON);
  if (parsed.error !== null) throw new Error(parsed.error);
  return {
    record: {
      recordFormat: 'protopeek-network-workspace',
      recordVersion: 1,
      id: parsed.value.id,
      bytes,
      workspaceJSON,
    },
    workspace: parsed.value,
    metadata: metadata(parsed.value, bytes),
  };
}

function restoreEntry(value: unknown): SessionEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored network workspace record must be an object.');
  }
  const record = value as Partial<StoredNetworkWorkspace>;
  const keys = Object.keys(record);
  if (
    keys.length !== 5 ||
    !keys.every((key) =>
      ['recordFormat', 'recordVersion', 'id', 'bytes', 'workspaceJSON'].includes(key)
    )
  ) {
    throw new Error('Stored network workspace record has unsupported fields.');
  }
  if (
    record.recordFormat !== 'protopeek-network-workspace' ||
    record.recordVersion !== 1 ||
    typeof record.id !== 'string' ||
    typeof record.workspaceJSON !== 'string' ||
    typeof record.bytes !== 'number' ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 0
  ) {
    throw new Error('Stored network workspace record is malformed.');
  }
  if (
    record.bytes > networkStoreLimits.maxWorkspaceBytes ||
    record.workspaceJSON.length > networkStoreLimits.maxWorkspaceBytes
  ) {
    throw new Error('Stored network workspace exceeds the 4 MiB limit.');
  }
  const bytes = boundedUTF8ByteLength(record.workspaceJSON, networkStoreLimits.maxWorkspaceBytes);
  if (bytes === null) throw new Error('Stored network workspace exceeds the 4 MiB limit.');
  if (bytes !== record.bytes) throw new Error('Stored network workspace byte count is corrupt.');
  const parsed = parseNetworkWorkspaceJSON(record.workspaceJSON);
  if (parsed.error !== null) throw new Error(parsed.error);
  if (parsed.value.id !== record.id) throw new Error('Stored network workspace id does not match.');
  if (serializeNetworkWorkspace(parsed.value) !== record.workspaceJSON) {
    throw new Error('Stored network workspace is not canonical.');
  }
  return {
    record: record as StoredNetworkWorkspace,
    workspace: parsed.value,
    metadata: metadata(parsed.value, bytes),
  };
}

// Avoid allocating an attacker-sized Uint8Array while restoring same-origin
// IndexedDB data. Isolated UTF-16 surrogates match TextEncoder's U+FFFD output.
function boundedUTF8ByteLength(value: string, maximum: number): number | null {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (following >= 0xdc00 && following <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > maximum) return null;
  }
  return bytes;
}

function success<T>(value: T, health: NetworkStoreHealth): NetworkStoreResult<T> {
  return { error: null, value, health };
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return 'Browser storage failed.';
}

function persistenceFailureReason(error: unknown): 'unavailable' | 'denied' | 'quota' {
  const name =
    error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
      ? error.name
      : '';
  if (name === 'SecurityError' || name === 'NotAllowedError') return 'denied';
  if (name === 'QuotaExceededError') return 'quota';
  return 'unavailable';
}

function sessionOnlyHealth(
  reason: 'unavailable' | 'denied' | 'quota' | 'corrupt',
  detail: string,
  quarantinedRecords = 0
): NetworkStoreHealth {
  const explanation = {
    unavailable: 'browser storage is unavailable',
    denied: 'browser storage access was denied',
    quota: 'browser storage quota was exceeded',
    corrupt: 'stored network data was corrupt',
  }[reason];
  return {
    mode: 'session-only',
    reason,
    error: `Network workspaces are session-only because ${explanation}. Export before leaving this page. ${detail}`,
    quarantinedRecords,
  };
}

function indexedDBTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function nativePersistence(): NetworkStorePersistence {
  return {
    open(configuration) {
      if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
      }
      return new Promise<NetworkStorePersistenceConnection>((resolve, reject) => {
        const request = indexedDB.open(configuration.databaseName, configuration.databaseVersion);
        let upgradeError: unknown = null;
        request.onupgradeneeded = () => {
          try {
            const database = request.result;
            if (!database.objectStoreNames.contains(configuration.objectStoreName)) {
              database.createObjectStore(configuration.objectStoreName, { keyPath: 'id' });
            }
          } catch (error) {
            upgradeError = error;
            request.transaction?.abort();
          }
        };
        request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab.'));
        request.onerror = () =>
          reject(upgradeError ?? request.error ?? new Error('IndexedDB could not be opened.'));
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(configuration.objectStoreName)) {
            database.close();
            reject(new Error('IndexedDB workspace store is missing.'));
            return;
          }
          database.onversionchange = () => database.close();
          resolve({
            async read(maxRecords) {
              const transaction = database.transaction(configuration.objectStoreName, 'readonly');
              const completed = indexedDBTransaction(transaction);
              const values: unknown[] = [];
              let overflow = false;
              const request = transaction.objectStore(configuration.objectStoreName).openCursor();
              request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return;
                if (values.length >= maxRecords) {
                  overflow = true;
                  return;
                }
                values.push(cursor.value);
                cursor.continue();
              };
              await completed;
              return { values, overflow };
            },
            put(value, expectedWorkspaceJSON) {
              const id = (value as Partial<StoredNetworkWorkspace>)?.id;
              if (typeof id !== 'string') return Promise.reject(new Error('Stored id is missing.'));
              return compareIndexedDBRecord(
                database,
                configuration.objectStoreName,
                id,
                expectedWorkspaceJSON,
                (store) => store.put(value)
              );
            },
            delete(id, expectedWorkspaceJSON) {
              return compareIndexedDBRecord(
                database,
                configuration.objectStoreName,
                id,
                expectedWorkspaceJSON,
                (store) => store.delete(id)
              );
            },
            close() {
              database.close();
            },
          });
        };
      });
    },
  };
}

function compareIndexedDBRecord(
  database: IDBDatabase,
  objectStoreName: string,
  id: string,
  expectedWorkspaceJSON: string | null,
  mutate: (store: IDBObjectStore) => IDBRequest
) {
  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(objectStoreName, 'readwrite');
    const store = transaction.objectStore(objectStoreName);
    let matched = false;
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as Partial<StoredNetworkWorkspace> | undefined;
      const currentJSON =
        current && typeof current.workspaceJSON === 'string' ? current.workspaceJSON : null;
      matched = currentJSON === expectedWorkspaceJSON;
      if (matched) mutate(store);
    };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve(matched);
    transaction.onabort = () =>
      reject(transaction.error ?? request.error ?? new Error('IndexedDB mutation was aborted.'));
    transaction.onerror = () =>
      reject(transaction.error ?? request.error ?? new Error('IndexedDB mutation failed.'));
  });
}

export class NetworkStore {
  private connection: NetworkStorePersistenceConnection | null = null;
  private readonly entries = new Map<string, SessionEntry>();
  private readonly persistentIDs = new Set<string>();
  private currentHealth: NetworkStoreHealth = persistentHealth;
  private initialization: Promise<NetworkStoreHealth> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly persistence: NetworkStorePersistence = nativePersistence()) {}

  initialize(): Promise<NetworkStoreHealth> {
    if (!this.initialization) {
      this.initialization = this.open().catch((error) =>
        this.enterSessionOnly(persistenceFailureReason(error), errorMessage(error))
      );
    }
    return this.initialization;
  }

  getHealth() {
    return this.currentHealth;
  }

  async list(): Promise<NetworkStoreResult<readonly NetworkStoreMetadata[]>> {
    await this.initialize();
    await this.mutationTail;
    const values = [...this.entries.values()]
      .map((entry) => entry.metadata)
      .sort(
        (left, right) =>
          compareText(right.updatedAt, left.updatedAt) || compareText(left.id, right.id)
      );
    return success(values, this.currentHealth);
  }

  async get(id: string): Promise<NetworkStoreResult<NetworkWorkspaceV1 | null>> {
    await this.initialize();
    await this.mutationTail;
    const entry = this.entries.get(id);
    if (!entry) return success(null, this.currentHealth);
    const restored = restoreEntry(entry.record);
    return success(restored.workspace, this.currentHealth);
  }

  put(
    workspace: unknown,
    options?: NetworkStorePutOptions
  ): Promise<NetworkStoreResult<NetworkStoreMetadata>> {
    return this.enqueueMutation(() => this.putNow(workspace, options));
  }

  delete(id: string): Promise<NetworkStoreResult<boolean>> {
    return this.enqueueMutation(() => this.deleteNow(id));
  }

  private async putNow(
    workspace: unknown,
    options?: NetworkStorePutOptions
  ): Promise<NetworkStoreResult<NetworkStoreMetadata>> {
    await this.initialize();
    let entry: SessionEntry;
    try {
      entry = prepareEntry(workspace);
      const previous = this.entries.get(entry.workspace.id);
      if (!previous && this.entries.size >= networkStoreLimits.maxWorkspaces) {
        throw new NetworkStoreFailure(
          'capacity',
          'Network storage holds at most 20 workspaces. Export or delete one before saving another.'
        );
      }
      const storedBytes = [...this.entries.values()].reduce(
        (total, stored) => total + stored.metadata.bytes,
        0
      );
      const nextStoredBytes = storedBytes - (previous?.metadata.bytes ?? 0) + entry.metadata.bytes;
      if (nextStoredBytes > networkStoreLimits.maxStoredBytes) {
        throw new NetworkStoreFailure(
          'capacity',
          'Network storage exceeds the 32 MiB serialized storage limit. Export or delete a workspace before saving.'
        );
      }
    } catch (error) {
      return {
        error: {
          code: error instanceof NetworkStoreFailure ? error.code : 'validation',
          message: error instanceof Error ? error.message : 'Network workspace is invalid.',
        },
        value: null,
        health: this.currentHealth,
      };
    }
    const previous = this.entries.get(entry.workspace.id);
    if (options) {
      let expectedJSON: string | null;
      try {
        expectedJSON = options.expectedPrevious
          ? serializeNetworkWorkspace(options.expectedPrevious)
          : null;
      } catch (error) {
        return {
          error: {
            code: 'validation',
            message:
              error instanceof Error ? error.message : 'Expected network workspace is invalid.',
          },
          value: null,
          health: this.currentHealth,
        };
      }
      if ((previous?.record.workspaceJSON ?? null) !== expectedJSON) {
        return this.conflict(entry.workspace.id);
      }
    }
    if (this.connection) {
      try {
        const stored = await this.connection.put(
          entry.record,
          previous?.record.workspaceJSON ?? null
        );
        if (!stored) return this.conflict(entry.workspace.id);
        this.persistentIDs.add(entry.workspace.id);
      } catch (error) {
        this.enterSessionOnly(persistenceFailureReason(error), errorMessage(error));
      }
    }
    this.entries.set(entry.workspace.id, entry);
    return success(entry.metadata, this.currentHealth);
  }

  private async deleteNow(id: string): Promise<NetworkStoreResult<boolean>> {
    await this.initialize();
    if (!this.entries.has(id)) return success(false, this.currentHealth);
    const entry = this.entries.get(id);
    if (!entry) return success(false, this.currentHealth);
    if (this.connection) {
      try {
        const deleted = await this.connection.delete(id, entry.record.workspaceJSON);
        if (!deleted) return this.conflict(id);
        this.persistentIDs.delete(id);
      } catch (error) {
        this.enterSessionOnly(persistenceFailureReason(error), errorMessage(error));
        return {
          error: {
            code: 'persistence',
            message: `Workspace ${id} was not deleted because browser storage failed. It remains visible so it cannot silently reappear after reload.`,
          },
          value: null,
          health: this.currentHealth,
        };
      }
    } else if (this.persistentIDs.has(id)) {
      return {
        error: {
          code: 'persistence',
          message: `Workspace ${id} was not deleted because its persistent copy is unavailable. Export it or clear this site's storage deliberately.`,
        },
        value: null,
        health: this.currentHealth,
      };
    }
    this.entries.delete(id);
    return success(true, this.currentHealth);
  }

  private async open() {
    this.connection = await this.persistence.open(networkStoreConfiguration);
    const boundedRead = await this.connection.read(networkStoreLimits.maxWorkspaces);
    const records = boundedRead.values;
    const restored: SessionEntry[] = [];
    let quarantinedRecords = boundedRead.overflow ? 1 : 0;
    for (const record of records) {
      try {
        restored.push(restoreEntry(record));
      } catch {
        quarantinedRecords++;
      }
    }
    restored.sort((left, right) => compareText(left.workspace.id, right.workspace.id));
    let storedBytes = 0;
    for (const entry of restored) {
      if (
        this.entries.has(entry.workspace.id) ||
        this.entries.size >= networkStoreLimits.maxWorkspaces ||
        storedBytes + entry.metadata.bytes > networkStoreLimits.maxStoredBytes
      ) {
        quarantinedRecords++;
        continue;
      }
      this.entries.set(entry.workspace.id, entry);
      this.persistentIDs.add(entry.workspace.id);
      storedBytes += entry.metadata.bytes;
    }
    if (quarantinedRecords > 0) {
      const grammar = quarantinedRecords === 1 ? 'record was' : 'records were';
      return this.enterSessionOnly(
        'corrupt',
        `${quarantinedRecords} stored ${grammar} invalid or beyond the bounded restore limits and quarantined.`,
        quarantinedRecords
      );
    }
    this.currentHealth = persistentHealth;
    return this.currentHealth;
  }

  private enterSessionOnly(
    reason: 'unavailable' | 'denied' | 'quota' | 'corrupt',
    detail: string,
    quarantinedRecords = 0
  ) {
    this.connection?.close?.();
    this.connection = null;
    this.currentHealth = sessionOnlyHealth(reason, detail, quarantinedRecords);
    return this.currentHealth;
  }

  private conflict<T>(id: string): NetworkStoreResult<T> {
    return {
      error: {
        code: 'conflict',
        message: `Workspace ${id} changed before this operation completed. Nothing was overwritten; reload the latest saved workspace before retrying.`,
      },
      value: null,
      health: this.currentHealth,
    };
  }

  private enqueueMutation<T>(operation: () => Promise<T>) {
    const pending = this.mutationTail.then(operation, operation);
    this.mutationTail = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }
}
