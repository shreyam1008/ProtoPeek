import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NetworkWorkspaceV1 } from './network-model';
import {
  NetworkStore,
  type NetworkStoreConfiguration,
  type NetworkStorePersistence,
  type NetworkStorePersistenceConnection,
  networkStoreConfiguration,
  networkStoreLimits,
} from './network-store';

const observedAt = '2026-08-21T10:00:00.000Z';

function workspace(id = 'home-lab', name = 'Home lab'): NetworkWorkspaceV1 {
  return {
    format: 'protopeek-network',
    version: 1,
    id,
    name,
    tags: ['lab'],
    notes: 'Local evidence',
    createdAt: observedAt,
    updatedAt: observedAt,
    nodes: [],
    edges: [],
    groups: [],
    snapshots: [],
  };
}

class FakePersistence implements NetworkStorePersistence {
  readonly records = new Map<string, unknown>();
  readonly opens: NetworkStoreConfiguration[] = [];
  openError: Error | null = null;
  putError: Error | null = null;
  deleteError: Error | null = null;
  putHook: ((value: unknown) => Promise<void>) | null = null;

  async open(configuration: NetworkStoreConfiguration): Promise<NetworkStorePersistenceConnection> {
    this.opens.push({ ...configuration });
    if (this.openError) throw this.openError;
    return {
      read: async (maxRecords) => ({
        values: structuredClone([...this.records.values()].slice(0, maxRecords)),
        overflow: this.records.size > maxRecords,
      }),
      put: async (value, expectedWorkspaceJSON) => {
        if (this.putError) throw this.putError;
        await this.putHook?.(value);
        const id = (value as { id: string }).id;
        const current = this.records.get(id) as { workspaceJSON?: unknown } | undefined;
        if (
          (typeof current?.workspaceJSON === 'string' ? current.workspaceJSON : null) !==
          expectedWorkspaceJSON
        ) {
          return false;
        }
        this.records.set(id, structuredClone(value));
        return true;
      },
      delete: async (id, expectedWorkspaceJSON) => {
        if (this.deleteError) throw this.deleteError;
        const current = this.records.get(id) as { workspaceJSON?: unknown } | undefined;
        if (current?.workspaceJSON !== expectedWorkspaceJSON) return false;
        this.records.delete(id);
        return true;
      },
    };
  }
}

describe('NetworkStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes the versioned store and survives a persistent reopen', async () => {
    const persistence = new FakePersistence();
    const first = new NetworkStore(persistence);

    expect(await first.initialize()).toEqual({
      mode: 'persistent',
      reason: null,
      error: null,
      quarantinedRecords: 0,
    });
    expect(persistence.opens).toEqual([networkStoreConfiguration]);

    const saved = await first.put(workspace());
    expect(saved.error).toBeNull();
    if (saved.error !== null) throw new Error(saved.error.message);
    expect(saved.value).toMatchObject({
      id: 'home-lab',
      name: 'Home lab',
      tags: ['lab'],
      createdAt: observedAt,
      updatedAt: observedAt,
      nodeCount: 0,
      edgeCount: 0,
      groupCount: 0,
      snapshotCount: 0,
    });
    expect(saved.value.bytes).toBeGreaterThan(0);

    const reopened = new NetworkStore(persistence);
    await reopened.initialize();
    const listed = await reopened.list();
    expect(listed.error).toBeNull();
    if (listed.error !== null) throw new Error(listed.error.message);
    expect(listed.value).toEqual([saved.value]);

    const loaded = await reopened.get('home-lab');
    expect(loaded).toEqual({
      error: null,
      value: workspace(),
      health: reopened.getHealth(),
    });
  });

  it('rejects invalid, oversized, and twenty-first workspaces without deleting records', async () => {
    const persistence = new FakePersistence();
    const store = new NetworkStore(persistence);

    const invalid = await store.put({ ...workspace(), authorization: 'Bearer secret' });
    expect(invalid.error).toMatchObject({ code: 'validation' });
    expect(persistence.records.size).toBe(0);

    const oversized = await store.put({
      ...workspace('oversized'),
      nodes: Array.from({ length: 300 }, (_, index) => ({
        id: `node-${index}`,
        label: `Node ${index}`,
        tags: [],
        notes: 'x'.repeat(16 << 10),
        deviceType: '',
        firstSeen: observedAt,
        lastSeen: observedAt,
        identities: [],
        ports: [],
        groupIds: [],
        position: { x: index, y: 0, pinned: false },
        provenance: [],
      })),
    });
    expect(oversized.error).toMatchObject({ code: 'capacity' });
    expect(persistence.records.size).toBe(0);

    for (let index = 0; index < networkStoreLimits.maxWorkspaces; index++) {
      const result = await store.put(workspace(`workspace-${index}`, `Workspace ${index}`));
      expect(result.error).toBeNull();
    }
    const overflow = await store.put(workspace('workspace-overflow', 'Overflow'));
    expect(overflow.error).toEqual({
      code: 'capacity',
      message:
        'Network storage holds at most 20 workspaces. Export or delete one before saving another.',
    });
    expect(persistence.records.size).toBe(networkStoreLimits.maxWorkspaces);
    expect(persistence.records.has('workspace-0')).toBe(true);
    expect(persistence.records.has('workspace-overflow')).toBe(false);

    const replacement = await store.put(workspace('workspace-0', 'Renamed'));
    expect(replacement.error).toBeNull();
    const loaded = await store.get('workspace-0');
    expect(loaded.error).toBeNull();
    if (loaded.error !== null) throw new Error(loaded.error.message);
    expect(loaded.value?.name).toBe('Renamed');
  });

  it('uses an explicit session-only fallback when persistence is denied', async () => {
    const persistence = new FakePersistence();
    persistence.openError = new DOMException('Access was denied.', 'SecurityError');
    const store = new NetworkStore(persistence);

    const health = await store.initialize();
    expect(health).toEqual({
      mode: 'session-only',
      reason: 'denied',
      error:
        'Network workspaces are session-only because browser storage access was denied. Export before leaving this page. Access was denied.',
      quarantinedRecords: 0,
    });

    const saved = await store.put(workspace());
    expect(saved.error).toBeNull();
    expect(saved.health).toEqual(health);
    expect(persistence.records.size).toBe(0);
    const loaded = await store.get('home-lab');
    expect(loaded.error).toBeNull();
    if (loaded.error !== null) throw new Error(loaded.error.message);
    expect(loaded.value).toEqual(workspace());
  });

  it('uses the session fallback when native IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = new NetworkStore();

    const health = await store.initialize();

    expect(health).toEqual({
      mode: 'session-only',
      reason: 'unavailable',
      error:
        'Network workspaces are session-only because browser storage is unavailable. Export before leaving this page. IndexedDB is unavailable in this browser.',
      quarantinedRecords: 0,
    });
    const saved = await store.put(workspace());
    expect(saved.error).toBeNull();
    expect(saved.health.mode).toBe('session-only');
  });

  it('preserves the persistent mirror and latest write after a quota failure', async () => {
    const persistence = new FakePersistence();
    const store = new NetworkStore(persistence);
    await store.put(workspace('first', 'First'));
    persistence.putError = new DOMException('Disk quota reached.', 'QuotaExceededError');

    const saved = await store.put(workspace('second', 'Second'));

    expect(saved.error).toBeNull();
    expect(saved.health).toEqual({
      mode: 'session-only',
      reason: 'quota',
      error:
        'Network workspaces are session-only because browser storage quota was exceeded. Export before leaving this page. Disk quota reached.',
      quarantinedRecords: 0,
    });
    expect([...persistence.records.keys()]).toEqual(['first']);
    persistence.putError = null;
    await store.put(workspace('third', 'Third'));
    expect([...persistence.records.keys()]).toEqual(['first']);

    const listed = await store.list();
    expect(listed.error).toBeNull();
    if (listed.error !== null) throw new Error(listed.error.message);
    expect(listed.value.map(({ id }) => id).sort()).toEqual(['first', 'second', 'third']);
    expect(listed.health.mode).toBe('session-only');
  });

  it('quarantines corrupt records while preserving valid workspaces in the session', async () => {
    const persistence = new FakePersistence();
    const first = new NetworkStore(persistence);
    await first.put(workspace('valid', 'Valid'));
    const corruptRecord = {
      recordFormat: 'protopeek-network-workspace',
      recordVersion: 1,
      id: 'corrupt',
      bytes: 2,
      workspaceJSON: '{}',
    };
    persistence.records.set('corrupt', corruptRecord);

    const reopened = new NetworkStore(persistence);
    const health = await reopened.initialize();

    expect(health).toEqual({
      mode: 'session-only',
      reason: 'corrupt',
      error:
        'Network workspaces are session-only because stored network data was corrupt. Export before leaving this page. 1 stored record was invalid or beyond the bounded restore limits and quarantined.',
      quarantinedRecords: 1,
    });
    const listed = await reopened.list();
    expect(listed.error).toBeNull();
    if (listed.error !== null) throw new Error(listed.error.message);
    expect(listed.value.map(({ id }) => id)).toEqual(['valid']);
    const corrupt = await reopened.get('corrupt');
    expect(corrupt).toMatchObject({ error: null, value: null, health });
    expect(persistence.records.get('corrupt')).toEqual(corruptRecord);

    await reopened.put(workspace('session-new', 'Session new'));
    expect(persistence.records.has('session-new')).toBe(false);
    const afterWrite = await reopened.list();
    expect(afterWrite.error).toBeNull();
    if (afterWrite.error !== null) throw new Error(afterWrite.error.message);
    expect(afterWrite.value.map(({ id }) => id).sort()).toEqual(['session-new', 'valid']);
  });

  it('serializes concurrent puts in invocation order so the latest save wins', async () => {
    const persistence = new FakePersistence();
    const store = new NetworkStore(persistence);
    let markFirstStarted = () => {};
    let releaseFirst = () => {};
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    persistence.putHook = async (value) => {
      const record = value as { workspaceJSON: string };
      const stored = JSON.parse(record.workspaceJSON) as { name: string };
      if (stored.name === 'First save') {
        markFirstStarted();
        await firstGate;
      }
    };

    const first = store.put(workspace('shared', 'First save'));
    await firstStarted;
    const second = store.put(workspace('shared', 'Second save'));
    releaseFirst();
    await Promise.all([first, second]);

    const reopened = new NetworkStore(persistence);
    const loaded = await reopened.get('shared');
    expect(loaded.error).toBeNull();
    if (loaded.error !== null) throw new Error(loaded.error.message);
    expect(loaded.value?.name).toBe('Second save');
  });

  it('uses an explicit previous workspace to reject two updates built from one stale base', async () => {
    const persistence = new FakePersistence();
    const store = new NetworkStore(persistence);
    const base = workspace('guarded', 'Base');
    await store.put(base);

    const first = await store.put(workspace('guarded', 'First append'), {
      expectedPrevious: base,
    });
    const second = await store.put(workspace('guarded', 'Second stale append'), {
      expectedPrevious: base,
    });

    expect(first.error).toBeNull();
    expect(second.error).toMatchObject({ code: 'conflict' });
    expect((await store.get('guarded')).value).toMatchObject({ name: 'First append' });
  });

  it('deletes explicitly and keeps the deletion after reopen', async () => {
    const persistence = new FakePersistence();
    const store = new NetworkStore(persistence);
    await store.put(workspace('first', 'First'));
    await store.put(workspace('second', 'Second'));

    const missing = await store.delete('missing');
    expect(missing).toMatchObject({ error: null, value: false });
    const deleted = await store.delete('first');
    expect(deleted).toMatchObject({ error: null, value: true });

    const reopened = new NetworkStore(persistence);
    const listed = await reopened.list();
    expect(listed.error).toBeNull();
    if (listed.error !== null) throw new Error(listed.error.message);
    expect(listed.value.map(({ id }) => id)).toEqual(['second']);
  });

  it('keeps a workspace visible when persistent deletion fails so it cannot resurrect silently', async () => {
    const persistence = new FakePersistence();
    const store = new NetworkStore(persistence);
    await store.put(workspace('important', 'Important'));
    persistence.deleteError = new DOMException('Storage device failed.', 'UnknownError');

    const deleted = await store.delete('important');

    expect(deleted.error).toMatchObject({ code: 'persistence' });
    expect(deleted.health.mode).toBe('session-only');
    expect((await store.get('important')).value).toMatchObject({ name: 'Important' });
    expect(persistence.records.has('important')).toBe(true);

    const secondAttempt = await store.delete('important');
    expect(secondAttempt.error).toMatchObject({ code: 'persistence' });
    expect((await store.get('important')).value).not.toBeNull();
  });

  it("rejects stale writes and deletes instead of losing another tab's update", async () => {
    const persistence = new FakePersistence();
    const first = new NetworkStore(persistence);
    await first.put(workspace('shared', 'Original'));
    const stale = new NetworkStore(persistence);
    await stale.initialize();

    await first.put(workspace('shared', 'New in first tab'));
    const staleWrite = await stale.put(workspace('shared', 'Stale overwrite'));
    const staleDelete = await stale.delete('shared');

    expect(staleWrite.error).toMatchObject({ code: 'conflict' });
    expect(staleDelete.error).toMatchObject({ code: 'conflict' });
    const reopened = new NetworkStore(persistence);
    expect((await reopened.get('shared')).value).toMatchObject({ name: 'New in first tab' });
  });

  it('bounds persisted restore by record count before accepting session data', async () => {
    const persistence = new FakePersistence();
    const writer = new NetworkStore(persistence);
    for (let index = 0; index < networkStoreLimits.maxWorkspaces; index++) {
      await writer.put(workspace(`bounded-${index}`, `Bounded ${index}`));
    }
    persistence.records.set('overflow', {
      recordFormat: 'protopeek-network-workspace',
      recordVersion: 1,
      id: 'overflow',
      bytes: 2,
      workspaceJSON: '{}',
    });

    const reopened = new NetworkStore(persistence);
    const health = await reopened.initialize();

    expect(health).toMatchObject({
      mode: 'session-only',
      reason: 'corrupt',
      quarantinedRecords: 1,
    });
    const listed = await reopened.list();
    expect(listed.error).toBeNull();
    expect(listed.value).toHaveLength(networkStoreLimits.maxWorkspaces);
  });
});
