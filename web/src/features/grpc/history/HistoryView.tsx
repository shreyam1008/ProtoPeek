import type { RequestHistoryEntry, SavedCollection } from '@/shared/types';
import { compactDate, durationLabel } from '@/shared/utils';

export function HistoryView({
  history,
  collections,
  onApply,
  onApplyCollection,
}: {
  history: RequestHistoryEntry[];
  collections: SavedCollection[];
  onApply: (entry: RequestHistoryEntry) => void;
  onApplyCollection: (collection: SavedCollection) => void;
}) {
  return (
    <div className="pp-history-layout">
      <section>
        <div className="pp-section-heading">
          <div>
            <span className="pp-kicker">Reusable</span>
            <h2>Saved requests</h2>
          </div>
          <span className="pp-count">{collections.length}</span>
        </div>
        {collections.length ? (
          <div className="pp-history-list">
            {collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                onClick={() => onApplyCollection(collection)}
                className="pp-history-row"
              >
                <div>
                  <strong>{collection.name}</strong>
                  <span>{collection.method}</span>
                </div>
                <small>{compactDate(collection.createdAt)}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="pp-empty-copy">Save the current request to reuse its body and metadata.</p>
        )}
      </section>
      <section>
        <div className="pp-section-heading">
          <div>
            <span className="pp-kicker">Evidence</span>
            <h2>Recent calls</h2>
          </div>
          <span className="pp-count">{history.length}</span>
        </div>
        {history.length ? (
          <div className="pp-history-list">
            {history.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onApply(entry)}
                className="pp-history-row"
              >
                <div>
                  <strong>{entry.method.split('/').pop() || entry.method}</strong>
                  <span>{entry.responsePreview}</span>
                </div>
                <small>
                  {compactDate(entry.createdAt)} · {durationLabel(entry.latencyMs)} ·{' '}
                  {entry.success ? 'OK' : 'ERR'}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="pp-empty-copy">Run an RPC to build local history.</p>
        )}
      </section>
    </div>
  );
}
