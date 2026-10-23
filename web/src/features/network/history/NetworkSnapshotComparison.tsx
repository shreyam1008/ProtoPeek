import { useMemo, useState } from 'react';
import type { NetworkSnapshot } from '@/console/network-model';
import { compareNetworkSnapshots } from '@/console/network-snapshot-diff';
import { usePagination } from '@/shared/use-pagination';
import './snapshot-comparison.css';

export default function NetworkSnapshotComparison({
  snapshots,
}: {
  snapshots: readonly NetworkSnapshot[];
}) {
  const [a, setA] = useState(snapshots.at(-2)?.id ?? '');
  const [b, setB] = useState(snapshots.at(-1)?.id ?? '');
  const before = snapshots.find((snapshot) => snapshot.id === a);
  const after = snapshots.find((snapshot) => snapshot.id === b);
  const changes = useMemo(
    () => (before && after && before !== after ? compareNetworkSnapshots(before, after) : []),
    [before, after]
  );
  const page = usePagination(changes, { pageSize: 25 });
  return (
    <section className="pp-snapshot-comparison" aria-label="Compare network snapshots">
      <h2>Compare observations</h2>
      <p>
        Absence means not observed in that snapshot. It does not prove an outage. Layout and
        observation-time changes are excluded.
      </p>
      <div className="pp-snapshot-selectors">
        {(
          [
            ['A', a, setA],
            ['B', b, setB],
          ] as const
        ).map(([label, value, setValue]) => (
          <label key={label}>
            Observation {label}
            <select value={value} onChange={(event) => setValue(event.target.value)}>
              {snapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {snapshot.label} · {new Date(snapshot.observedAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {before === after ? (
        <p role="status">Choose two different observations.</p>
      ) : before && after ? (
        <>
          <p>
            <time dateTime={before.observedAt}>{before.observedAt}</time> →{' '}
            <time dateTime={after.observedAt}>{after.observedAt}</time>
          </p>
          <p role="status">
            {(['added', 'not-observed', 'changed', 'ambiguous'] as const)
              .map(
                (kind) =>
                  `${changes.filter((change) => change.kind === kind).length} ${kind.replace('-', ' ')}`
              )
              .join(' · ')}
          </p>
          {!changes.length ? <p>No evidence changes between these observations.</p> : null}
          <div>
            {page.pageItems.map((change) => (
              <details key={change.id}>
                <summary>
                  <strong>{change.label}</strong> · {change.entity} ·{' '}
                  {change.kind.replace('-', ' ')}
                </summary>
                <ul>
                  {change.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
                <p>
                  Sources:{' '}
                  {[
                    ...new Set(
                      change.sources.map(
                        (source) => `${source.source} · ${source.kind} · ${source.observedAt}`
                      )
                    ),
                  ].join('; ') || 'No source recorded'}
                </p>
                {change.sources
                  .filter((source) => source.source === 'ip-attribution')
                  .map((source) => (
                    <p key={`${source.observedAt}-${source.kind}-${source.detail}`}>
                      {source.detail}
                    </p>
                  ))}
              </details>
            ))}
          </div>
          {page.pageCount > 1 ? (
            <nav aria-label="Snapshot difference pages">
              <button type="button" disabled={!page.canPreviousPage} onClick={page.previousPage}>
                Previous changes
              </button>
              <span>
                {page.pageIndex + 1} / {page.pageCount}
              </span>
              <button type="button" disabled={!page.canNextPage} onClick={page.nextPage}>
                Next changes
              </button>
            </nav>
          ) : null}
        </>
      ) : (
        <p>Choose two saved observations.</p>
      )}
    </section>
  );
}
