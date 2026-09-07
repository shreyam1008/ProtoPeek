import { useEffect, useRef, useState } from 'react';
import { attributionSource, type IPAttribution } from './ip-attribution';
import { fetchIPAttribution } from './ip-attribution-api';
import './hop-attribution.css';

export default function HopAttribution({
  addresses,
  result,
  onResult,
}: {
  addresses: string[];
  result?: IPAttribution;
  onResult: (result: IPAttribution) => void;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    []
  );
  const plan = [...new Set(addresses)].slice(0, 32);
  async function run() {
    if (!consent || busy || !plan.length) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setConsent(false);
    setMessage('');
    try {
      const next = await fetchIPAttribution(plan, current.signal);
      if (controller.current === current) onResult(next);
    } catch (error) {
      if (controller.current === current)
        setMessage(error instanceof Error ? error.message : 'IP attribution failed.');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setMessage('Attribution cancelled. Existing hop measurements are unchanged.');
  }
  return (
    <section className="pp-hop-attribution" aria-label="Optional hop attribution">
      <div>
        <strong>Provider & approximate location</strong>
        <span>IPWHOIS labels · measured RTT stays separate</span>
      </div>
      <details>
        <summary>{plan.length} unique responder addresses · review</summary>
        <p>{plan.join(', ') || 'No responding addresses.'}</p>
        <p>
          Only public addresses are sent to ipwho.is. Local/private addresses are skipped. Up to two
          requests at a time, 30 seconds total, with a 15-minute host cache. IP location does not
          establish a physical datacenter or the return route.{' '}
          <a href={attributionSource} target="_blank" rel="noreferrer">
            Provider documentation
          </a>
        </p>
        {addresses.length > 32 ? <p>Only the first 32 unique responders are included.</p> : null}
      </details>
      <div className="pp-hop-attribution-actions">
        <label>
          <input
            type="checkbox"
            checked={consent}
            disabled={busy || !plan.length}
            onChange={(event) => setConsent(event.target.checked)}
          />{' '}
          Send public responder IPs to ipwho.is
        </label>
        {busy ? (
          <button type="button" onClick={cancel}>
            Cancel attribution
          </button>
        ) : (
          <button type="button" disabled={!consent || !plan.length} onClick={() => void run()}>
            {result ? 'Refresh hop labels' : 'Look up hop labels'}
          </button>
        )}
      </div>
      {busy || message ? (
        <p role="status">{busy ? 'Looking up responder labels…' : message}</p>
      ) : null}
      {result ? (
        <p>
          {result.entries.filter((entry) => entry.status === 'observed').length} attributed ·{' '}
          {result.entries.filter((entry) => entry.status === 'skipped').length} local/skipped ·{' '}
          {result.entries.filter((entry) => entry.status === 'failed').length} failed. Save trace
          retains these dated labels.
        </p>
      ) : null}
    </section>
  );
}
