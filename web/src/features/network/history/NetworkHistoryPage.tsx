import { Trash2 } from 'lucide-react';

import type { NetworkWorkspaceV1 } from '@/console/network-model';
import type { NetworkStoreMetadata } from '@/console/network-store';
import { ExportActions, NetworkEmptyState } from '../NetworkWorkspaceActions';

export function NetworkHistoryPage({
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
