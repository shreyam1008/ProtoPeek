import { Timer } from 'lucide-react';

import type { ThisPCCapabilities, ThisPCTrafficSample } from '@/console/this-pc-api';

import { formatAverageBitRate, formatDecimalBytes, formatObservedAt } from './device-format';
import type { IdleResource, Resource } from './device-state';

export function InterfaceLoadPanel({
  capabilities,
  state,
  duration,
  onDuration,
  onSample,
}: {
  capabilities: Resource<ThisPCCapabilities>;
  state: IdleResource<ThisPCTrafficSample>;
  duration: 500 | 1000 | 2000;
  onDuration: (duration: 500 | 1000 | 2000) => void;
  onSample: () => void;
}) {
  const capability = capabilities.status === 'ready' ? capabilities.value.trafficSample : null;
  const durations = capability?.durationsMs ?? [];
  return (
    <section className="this-pc-panel this-pc-traffic" aria-labelledby="traffic-sample-title">
      <header>
        <div>
          <h2 id="traffic-sample-title">One-shot interface traffic sample</h2>
          <p>
            Reads local interface counters twice; no background sampling and no per-process claim.
          </p>
        </div>
        <div className="this-pc-sample-actions">
          <label>
            <span>Duration</span>
            <select
              aria-label="Traffic sample duration"
              value={duration}
              disabled={!capability?.supported || state.status === 'loading'}
              onChange={(event) => onDuration(Number(event.target.value) as 500 | 1000 | 2000)}
            >
              {durations.map((item) => (
                <option key={item} value={item}>
                  {item} ms
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="this-pc-button"
            disabled={!capability?.supported || state.status === 'loading'}
            onClick={onSample}
          >
            <Timer aria-hidden="true" /> {state.status === 'loading' ? 'Sampling…' : 'Sample once'}
          </button>
        </div>
      </header>
      {state.status === 'ready' ? (
        <div className="this-pc-traffic-results">
          {state.value.interfaces.map((item) => (
            <article key={item.name}>
              <header>
                <strong>{item.name}</strong>
                <span>{item.status.replace('-', ' ')}</span>
              </header>
              {item.counters ? (
                <dl>
                  <div>
                    <dt>Received delta</dt>
                    <dd>{formatDecimalBytes(item.counters.receivedBytes)}</dd>
                  </div>
                  <div>
                    <dt>Transmitted delta</dt>
                    <dd>{formatDecimalBytes(item.counters.transmittedBytes)}</dd>
                  </div>
                  <div>
                    <dt>Average RX rate</dt>
                    <dd>
                      {formatAverageBitRate(item.counters.receivedBytes, state.value.durationMs)}
                    </dd>
                  </div>
                  <div>
                    <dt>Average TX rate</dt>
                    <dd>
                      {formatAverageBitRate(item.counters.transmittedBytes, state.value.durationMs)}
                    </dd>
                  </div>
                  <div>
                    <dt>RX packets</dt>
                    <dd>{item.counters.receivedPackets}</dd>
                  </div>
                  <div>
                    <dt>TX packets</dt>
                    <dd>{item.counters.transmittedPackets}</dd>
                  </div>
                </dl>
              ) : (
                <p>No delta is reported for this interface state.</p>
              )}
            </article>
          ))}
          <small>
            {state.value.durationMs} ms local sample · finished{' '}
            {formatObservedAt(state.value.finishedAt)}
          </small>
        </div>
      ) : state.status === 'error' ? (
        <p className="this-pc-inline-error" role="alert">
          {state.error}
        </p>
      ) : state.status === 'idle' ? (
        <p className="this-pc-empty">
          No traffic sample has been requested.
          {!capability?.supported && capability?.reason ? ` ${capability.reason}` : ''}
        </p>
      ) : (
        <p className="this-pc-empty" role="status">
          Waiting for the bounded local sample…
        </p>
      )}
    </section>
  );
}
