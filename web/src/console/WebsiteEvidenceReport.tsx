import { Copy, Download } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type { WebsiteObservationResult } from './security-api';
import {
  analyzeWebsiteObservation,
  type WebsiteEvidenceStatus,
  websiteEvidenceLimitation,
} from './website-evidence';

type EvidenceCopyState = 'idle' | 'copied' | 'unavailable' | 'failed';

const evidenceCopyMessages: Record<EvidenceCopyState, string> = {
  idle: 'JSON includes the observation, request boundary, and derived labels.',
  copied: 'JSON evidence report copied.',
  unavailable: 'Clipboard access is unavailable in this browser.',
  failed: 'Report could not be copied. Allow clipboard access and retry.',
};

const evidenceStatusLabels: Record<WebsiteEvidenceStatus, string> = {
  observed: 'Observed',
  'not observed': 'Not observed',
  attention: 'Attention',
};

export default function WebsiteEvidenceReport({ result }: { result: WebsiteObservationResult }) {
  const titleID = useId();
  const limitationID = useId();
  const [copyState, setCopyState] = useState<EvidenceCopyState>('idle');
  const report = useMemo(() => analyzeWebsiteObservation(result), [result]);
  const reportJSON = useMemo(() => `${JSON.stringify(report, null, 2)}\n`, [report]);

  async function copyReport() {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      setCopyState('unavailable');
      return;
    }
    try {
      await clipboard.writeText(reportJSON);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  function downloadReport() {
    const url = URL.createObjectURL(new Blob([reportJSON], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'protopeek-website-report.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="pp-security-evidence-report" aria-labelledby={titleID}>
      <header>
        <div>
          <span>Local analysis · no added request</span>
          <h3 id={titleID}>HEAD evidence report</h3>
        </div>
        <button
          type="button"
          className="pp-security-copy-report"
          aria-describedby={limitationID}
          onClick={() => void copyReport()}
        >
          <Copy aria-hidden="true" /> Copy JSON report
        </button>
        <button type="button" className="pp-security-copy-report" onClick={downloadReport}>
          <Download aria-hidden="true" /> Save JSON report
        </button>
      </header>

      <p id={limitationID} className="pp-security-evidence-limit">
        {websiteEvidenceLimitation}
      </p>

      <section className="pp-website-technologies" aria-label="Advertised technology">
        <h4>Advertised technology</h4>
        <p>Headers advertise a framework, runtime, or edge server; they may describe a proxy.</p>
        {report.technologyHints.length ? (
          <dl>
            {report.technologyHints.map((hint) => (
              <div key={`${hint.source}:${hint.advertised}`}>
                <dt>{hint.category}</dt>
                <dd>
                  <strong>{hint.name}</strong>
                  <small>
                    Advertised by <code>{hint.source}</code>
                  </small>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>No technology was advertised. The application stack is unknown.</p>
        )}
      </section>

      <details className="pp-website-header-checks">
        <summary>
          Response policies · {report.checks.filter((check) => check.status === 'observed').length}{' '}
          observed, {report.checks.filter((check) => check.status === 'attention').length} need
          review
        </summary>
        <ul className="pp-security-check-list" aria-label="HEAD response evidence checks">
          {report.checks.map((check) => (
            <li key={check.id} className={`is-${check.status.replace(' ', '-')}`}>
              <span>{evidenceStatusLabels[check.status]}</span>
              <strong>{check.label}</strong>
              <p>{check.summary}</p>
            </li>
          ))}
        </ul>
      </details>

      <p
        className={`pp-security-copy-state${
          copyState === 'failed' || copyState === 'unavailable' ? ' is-error' : ''
        }`}
        role={
          copyState === 'idle'
            ? undefined
            : copyState === 'failed' || copyState === 'unavailable'
              ? 'alert'
              : 'status'
        }
        aria-live={copyState === 'idle' ? undefined : 'polite'}
      >
        {evidenceCopyMessages[copyState]}
      </p>
    </section>
  );
}
