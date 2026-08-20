import { CircleAlert, Copy, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { HTTPResponse, HTTPTimings, MetadataEntry } from '@/shared/types';
import { classNames, durationLabel } from '@/shared/utils';

import { AccessibleTabs, TabPanel } from './AccessibleTabs';

type HTTPResponseTab = 'body' | 'headers' | 'timing' | 'redirects' | 'status';

const responseTabs: Array<{ value: HTTPResponseTab; label: string }> = [
  { value: 'body', label: 'Body' },
  { value: 'headers', label: 'Headers' },
  { value: 'timing', label: 'Timing' },
  { value: 'redirects', label: 'Redirects' },
  { value: 'status', label: 'Status' },
];

export function HTTPResponsePanel({
  response,
  loading,
  error,
}: {
  response: HTTPResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const [tab, setTab] = useState<HTTPResponseTab>('body');

  useEffect(() => {
    if (response) setTab('body');
  }, [response]);

  function renderResponseTab(value: HTTPResponseTab) {
    if (!response) return <HTTPResponseState loading={loading} error={error} />;
    switch (value) {
      case 'body':
        return (
          <>
            <div className="pp-http-evidence-toolbar">
              <span>
                {response.bodyEncoding} · {response.bytes.toLocaleString()} bytes
                {response.truncated ? ' · truncated' : ''}
              </span>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(response.body)}
              >
                <Copy aria-hidden="true" /> Copy
              </button>
            </div>
            <pre>{response.body || '(empty body)'}</pre>
          </>
        );
      case 'headers':
        return <HeaderTable headers={response.headers} />;
      case 'timing':
        return <TimingEvidence timings={response.timings} />;
      case 'redirects':
        return response.redirects.length ? (
          <ol className="pp-http-redirect-list">
            {response.redirects.map((redirect, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: redirect hops are immutable evidence in wire order
              <li key={`${redirect.url}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{redirect.status}</strong>
                  <code className="pp-http-redirect-url">{redirect.url}</code>
                  <small>Location: {redirect.location || '(missing)'}</small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="pp-response-placeholder">No redirects were encountered.</div>
        );
      case 'status':
        return (
          <div className="pp-http-status-grid">
            <EvidenceRow label="Status" value={response.status} />
            <EvidenceRow label="Protocol" value={response.proto} />
            <EvidenceRow label="Remote IP" value={response.remoteIp || 'Unavailable'} />
            <EvidenceRow
              label="Body"
              value={`${response.bytes.toLocaleString()} bytes${response.truncated ? ' (truncated)' : ''}`}
            />
            <EvidenceRow
              label="TLS"
              value={
                response.tls ? `${response.tls.version} · ${response.tls.cipherSuite}` : 'None'
              }
            />
            {response.tls ? (
              <>
                <EvidenceRow label="Server name" value={response.tls.serverName || 'Unavailable'} />
                <EvidenceRow
                  label="Certificate"
                  value={response.tls.peerSubject || 'Unavailable'}
                />
                <EvidenceRow
                  label="Certificate expiry"
                  value={response.tls.peerExpiresAt || 'Unavailable'}
                />
                <EvidenceRow
                  label="Verification"
                  value={response.tls.verified ? 'Verified' : 'Not verified'}
                />
              </>
            ) : null}
          </div>
        );
    }
  }

  return (
    <section className="pp-http-response" aria-label="HTTP response evidence">
      <div className="pp-http-response-summary" aria-live="polite">
        <span
          className={classNames(
            'pp-status-mark',
            error && 'pp-status-mark-error',
            loading && 'pp-status-mark-running'
          )}
        >
          {loading ? 'IN FLIGHT' : error ? 'ERROR' : response ? response.statusCode : 'READY'}
        </span>
        <strong>{response?.status ?? 'No response yet'}</strong>
        <span>{response?.proto ?? '—'}</span>
        <span className="pp-response-time">
          {response ? durationLabel(response.timings.totalMs) : '—'}
        </span>
      </div>
      <AccessibleTabs
        id="http-response"
        label="HTTP response evidence"
        tabs={responseTabs}
        value={tab}
        onChange={setTab}
        className="pp-response-tabs"
      />
      <div className="pp-http-response-content">
        {responseTabs.map(({ value }) => (
          <TabPanel
            key={value}
            id="http-response"
            tab={value}
            className={value === 'body' ? 'pp-http-body-panel' : undefined}
            active={tab === value}
          >
            {tab === value ? renderResponseTab(value) : null}
          </TabPanel>
        ))}
      </div>
    </section>
  );
}

function HTTPResponseState({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className="pp-response-placeholder">
        <LoaderCircle className="pp-response-spinner" aria-hidden="true" />
        Waiting for HTTP evidence. Use Cancel to stop the request.
      </div>
    );
  }
  if (error) {
    return (
      <div className="pp-response-error" role="alert">
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>Request failed</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="pp-response-placeholder">
      Send a request to inspect status, headers, redirects, transport, and timing.
    </div>
  );
}

function HeaderTable({ headers }: { headers: MetadataEntry[] }) {
  if (!headers.length) return <div className="pp-response-placeholder">No response headers.</div>;
  return (
    <dl className="pp-http-header-table">
      {headers.map((header, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: repeated response headers are immutable evidence in wire order
        <div key={`${header.name}-${index}`}>
          <dt>{header.name}</dt>
          <dd>{header.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TimingEvidence({ timings }: { timings: HTTPTimings }) {
  const rows: Array<[string, number]> = [
    ['DNS', timings.dnsMs],
    ['Connect', timings.connectMs],
    ['TLS', timings.tlsMs],
    ['TTFB', timings.ttfbMs],
    ['Total', timings.totalMs],
  ];
  const total = Math.max(timings.totalMs, 0.01);
  return (
    <div className="pp-http-timings">
      <p>Connection phases are captured by Go&apos;s HTTP trace for this request.</p>
      {rows.map(([label, value]) => (
        <div key={label} className="pp-http-timing-row">
          <span>{label}</span>
          <i
            style={{
              width: `${Math.min(100, Math.max(value > 0 ? 2 : 0, (value / total) * 100))}%`,
            }}
          />
          <code className="pp-http-timing-value">{durationLabel(value)}</code>
        </div>
      ))}
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
