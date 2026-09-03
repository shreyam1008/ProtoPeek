import { Gauge, Play, Square, Upload } from 'lucide-react';

import {
  createThisPCBenchmarkConfig,
  type ThisPCBenchmarkProfileID,
  type ThisPCBenchmarkSummary,
  thisPCBenchmarkPayloadBytes,
  thisPCBenchmarkProfiles,
} from '@/console/this-pc-benchmark';

import { ConsentPrompt } from './ConsentPrompt';
import { formatMilliseconds, formatPayloadBytes, formatRate } from './device-format';
import type { QualityPlanStage } from './device-state';

export function QualityPlanSummary({ onOpen }: { onOpen: () => void }) {
  const profile = thisPCBenchmarkProfiles.quick;
  const maximum = thisPCBenchmarkPayloadBytes('quick', false);
  return (
    <section
      className="this-pc-panel this-pc-benchmark-card"
      aria-labelledby="benchmark-card-title"
    >
      <header>
        <div>
          <h2 id="benchmark-card-title">
            Benchmark <small>(internet path quality)</small>
          </h2>
          <p>Idle until you consent. Results are not stored.</p>
        </div>
      </header>
      <dl>
        <div>
          <dt>Provider</dt>
          <dd>Cloudflare edge</dd>
        </div>
        <div>
          <dt>Profile</dt>
          <dd>Quick · download only by default</dd>
        </div>
        <div>
          <dt>Max planned payload</dt>
          <dd>{formatPayloadBytes(maximum)}</dd>
        </div>
        <div>
          <dt>Wall guard</dt>
          <dd>{profile.wallLimitMs / 1000} seconds</dd>
        </div>
      </dl>
      <button type="button" className="this-pc-button is-wide" onClick={onOpen}>
        <Gauge aria-hidden="true" /> Run bounded benchmark
      </button>
      <small className="this-pc-action-note">
        Single-flow HTTPS quality from this browser to Cloudflare edge; not host throughput or line
        speed.
      </small>
    </section>
  );
}

export function EvidenceBoundaries() {
  return (
    <section
      className="this-pc-panel this-pc-boundaries"
      aria-labelledby="this-pc-boundaries-title"
    >
      <header>
        <h2 id="this-pc-boundaries-title">What this view does not do</h2>
      </header>
      <ul>
        <li>Does not scan or probe the network automatically.</li>
        <li>Does not prove a local listener is reachable from the internet.</li>
        <li>Does not collect or store This Device evidence in browser storage.</li>
        <li>Shows only information gathered on demand in this process/network namespace.</li>
      </ul>
    </section>
  );
}

function BenchmarkResults({ summary }: { summary: ThisPCBenchmarkSummary }) {
  const rows = [
    ['Download sample', formatRate(summary.download)],
    ['Upload sample', formatRate(summary.upload)],
    ['Idle latency', formatMilliseconds(summary.latency)],
    ['Idle jitter', formatMilliseconds(summary.jitter)],
    ['Latency during download', formatMilliseconds(summary.downLoadedLatency)],
    ['Latency during upload', formatMilliseconds(summary.upLoadedLatency)],
  ];
  return (
    <dl className="this-pc-benchmark-results">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function QualityPlanPanel({
  stage,
  summary,
  phase,
  message,
  profileID,
  uploadEnabled,
  acknowledged,
  onOpen,
  onProfile,
  onUpload,
  onAcknowledged,
  onStart,
  onCancel,
  onStop,
}: {
  stage: QualityPlanStage;
  summary: ThisPCBenchmarkSummary;
  phase: string;
  message: string;
  profileID: ThisPCBenchmarkProfileID;
  uploadEnabled: boolean;
  acknowledged: boolean;
  onOpen: () => void;
  onProfile: (profile: ThisPCBenchmarkProfileID) => void;
  onUpload: (enabled: boolean) => void;
  onAcknowledged: (acknowledged: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
  onStop: () => void;
}) {
  const profile = thisPCBenchmarkProfiles[profileID];
  const config = createThisPCBenchmarkConfig(profileID, uploadEnabled);
  const payload = thisPCBenchmarkPayloadBytes(profileID, uploadEnabled);
  return (
    <div className="this-pc-benchmark-layout">
      <section className="this-pc-panel this-pc-benchmark-main" aria-labelledby="benchmark-title">
        <header>
          <div>
            <h2 id="benchmark-title">Bounded connection benchmark</h2>
            <p>
              Single-flow HTTPS quality from this browser to Cloudflare edge; this is not host
              throughput or a line-speed claim.
            </p>
          </div>
          {stage === 'running' || stage === 'loading' ? (
            <button type="button" className="this-pc-button is-stop" onClick={onStop}>
              <Square aria-hidden="true" /> Stop after current measurement
            </button>
          ) : null}
        </header>

        {stage === 'consent' ? (
          <ConsentPrompt
            title="Run one bounded Cloudflare benchmark"
            acknowledged={acknowledged}
            onAcknowledged={onAcknowledged}
            acknowledgement="I understand this sends the selected synthetic traffic to Cloudflare once."
            onConfirm={onStart}
            onCancel={onCancel}
            confirmLabel="Start one run"
          >
            <p>
              Cloudflare sees your public IP and the synthetic HTTPS measurement requests, and may
              retain ordinary service logs. ProtoPeek disables the engine's dedicated
              per-measurement and final-results logging endpoints.
            </p>
            <p>
              The upstream engine would otherwise submit completed results. ProtoPeek sets both
              logging endpoints to null for this run. Results stay in memory and disappear when this
              page closes.
            </p>
            <p>
              ProtoPeek does not add collected PC evidence to benchmark requests, but the browser
              may send ordinary request metadata such as its local origin.
            </p>
            <fieldset className="this-pc-profile-options">
              <legend>Run profile</legend>
              {(
                Object.values(thisPCBenchmarkProfiles) as Array<
                  (typeof thisPCBenchmarkProfiles)[ThisPCBenchmarkProfileID]
                >
              ).map((item) => (
                <label key={item.id}>
                  <input
                    type="radio"
                    name="this-pc-benchmark-profile"
                    value={item.id}
                    checked={profileID === item.id}
                    onChange={() => onProfile(item.id)}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      {item.wallLimitMs / 1000}s wall ·{' '}
                      {formatPayloadBytes(thisPCBenchmarkPayloadBytes(item.id, false))}{' '}
                      download-only
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="this-pc-upload-option">
              <input
                type="checkbox"
                checked={uploadEnabled}
                onChange={(event) => onUpload(event.target.checked)}
              />
              <Upload aria-hidden="true" />
              <span>
                <strong>Include upload samples</strong>
                <small>Off by default. Adds synthetic POST payloads.</small>
              </span>
            </label>
            <dl className="this-pc-budget-preview">
              <div>
                <dt>Maximum planned payload</dt>
                <dd>{formatPayloadBytes(payload)}</dd>
              </div>
              <div>
                <dt>Largest planned item</dt>
                <dd>{formatPayloadBytes(profile.largestItemBytes)}</dd>
              </div>
              <div>
                <dt>Wall guard</dt>
                <dd>{profile.wallLimitMs / 1000} seconds</dd>
              </div>
            </dl>
            <p className="this-pc-confidence-note">{profile.confidence}</p>
            <small>
              The configured profile starts with {profile.latencyPackets} unloaded-latency probes.
              The planned payload cap counts configured download/upload bodies; it excludes HTTP/TLS
              overhead plus zero-byte unloaded and loaded-latency probes. Slow paths can finish
              early; the wall guard pauses further work but does not promise browser-level abortion
              of an already-started request.
            </small>
          </ConsentPrompt>
        ) : stage === 'idle' ? (
          <div className="this-pc-benchmark-idle">
            <Gauge aria-hidden="true" />
            <h3>Nothing runs until you review the exact budget.</h3>
            <p>Download-only is the default. Upload is a separate opt-in inside the run preview.</p>
            <button type="button" className="this-pc-button" onClick={onOpen}>
              <Play aria-hidden="true" /> Review and run
            </button>
          </div>
        ) : (
          <div className="this-pc-benchmark-live" aria-live="polite">
            <div className="this-pc-benchmark-state">
              <i className={stage === 'running' ? 'is-running' : undefined} aria-hidden="true" />
              <span>
                <strong>
                  {stage === 'loading'
                    ? 'Loading the benchmark engine after consent'
                    : stage === 'running'
                      ? `Measuring ${phase || 'connection quality'}`
                      : stage === 'finished'
                        ? 'One bounded run finished'
                        : stage === 'stopped'
                          ? 'Further measurements paused'
                          : 'Benchmark could not finish'}
                </strong>
                <small>{message || 'Results update after each completed measurement.'}</small>
              </span>
            </div>
            <BenchmarkResults summary={summary} />
            {stage === 'finished' || stage === 'stopped' || stage === 'error' ? (
              <button type="button" className="this-pc-button is-quiet" onClick={onOpen}>
                Review a new one-run budget
              </button>
            ) : null}
          </div>
        )}
      </section>

      <aside className="this-pc-panel this-pc-benchmark-contract">
        <h2>Run contract</h2>
        <dl>
          <div>
            <dt>Engine</dt>
            <dd>@cloudflare/speedtest 1.12.1</dd>
          </div>
          <div>
            <dt>Start</dt>
            <dd>Explicit consent; auto-start disabled</dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{profile.label}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{uploadEnabled ? 'Download + opted-in upload' : 'Download only'}</dd>
          </div>
          <div>
            <dt>Payload cap</dt>
            <dd>{formatPayloadBytes(payload)}</dd>
          </div>
          <div>
            <dt>Request guard</dt>
            <dd>{Number(config.bandwidthAbortRequestDuration) / 1000} seconds</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>Memory only</dd>
          </div>
        </dl>
        <p>
          Stop uses the library's pause control. ProtoPeek does not claim a general hard-cancel API
          or a measurement of full line capacity.
        </p>
      </aside>
    </div>
  );
}
