import { Copy } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type { WebsiteObservationResult } from './security-api';
import {
  analyzeWebsiteObservation,
  type WebsiteEvidenceStatus,
  websiteEvidenceLimitation,
} from './website-evidence';

type EvidenceCopyState = 'idle' | 'copied' | 'unavailable' | 'failed';

const evidenceCopyMessages: Record<EvidenceCopyState, string> = {
  idle: 'JSON contains this retained observation, its fixed request boundary, and the derived labels.',
  copied: 'JSON evidence report copied.',
  unavailable: 'Clipboard access is unavailable in this browser context.',
  failed: 'The JSON evidence report could not be copied. Allow clipboard access and try again.',
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

  return (
    <section className="pp-security-evidence-report" aria-labelledby={titleID}>
      <header>
        <div>
          <span>Derived locally · no added target request</span>
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
      </header>

      <p id={limitationID} className="pp-security-evidence-limit">
        {websiteEvidenceLimitation}
      </p>

      <ul className="pp-security-check-list" aria-label="HEAD response evidence checks">
        {report.checks.map((check) => (
          <li key={check.id} className={`is-${check.status.replace(' ', '-')}`}>
            <span>{evidenceStatusLabels[check.status]}</span>
            <strong>{check.label}</strong>
            <p>{check.summary}</p>
          </li>
        ))}
      </ul>

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
