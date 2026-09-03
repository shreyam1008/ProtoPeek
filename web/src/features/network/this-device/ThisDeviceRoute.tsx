import {
  Activity,
  ArrowRight,
  CircleAlert,
  Gauge,
  Globe2,
  Monitor,
  Network,
  Radio,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';

import { DeviceSummary } from './DeviceSummary';
import { formatObservedAt } from './device-format';
import type { DeviceView } from './device-state';
import { InterfaceLoadPanel } from './InterfaceLoadPanel';
import { InterfacesPanel } from './InterfacesPanel';
import { PublicAddressPanel } from './PublicAddressPanel';
import { EvidenceBoundaries, QualityPlanPanel, QualityPlanSummary } from './QualityPlanPanel';
import { SocketsPanel } from './SocketsPanel';
import { useDeviceActions } from './useDeviceActions';
import { useDeviceCapabilities } from './useDeviceCapabilities';
import { useQualityPlan } from './useQualityPlan';

const sectionViews = [
  { id: 'overview', label: 'Overview', icon: Monitor },
  { id: 'listeners', label: 'Listeners', icon: Radio },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'benchmark', label: 'Benchmark', icon: Gauge },
] as const;

function DeviceSectionTabs({
  active,
  onChange,
  mobile = false,
}: {
  active: DeviceView;
  onChange: (view: DeviceView) => void;
  mobile?: boolean;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (current + direction + sectionViews.length) % sectionViews.length;
    const next = sectionViews[nextIndex];
    onChange(next.id);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  }

  if (mobile) {
    return (
      <nav className="this-pc-bottom-tabs" aria-label="This Device mobile sections">
        {sectionViews.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={active === section.id ? 'page' : undefined}
            className={active === section.id ? 'is-active' : undefined}
            onClick={() => onChange(section.id)}
          >
            <section.icon aria-hidden="true" />
            <span>{section.label}</span>
          </button>
        ))}
      </nav>
    );
  }
  return (
    <div className="this-pc-tabs" role="tablist" aria-label="This Device sections">
      {sectionViews.map((section, index) => (
        <button
          key={section.id}
          id={`this-pc-tab-${section.id}`}
          type="button"
          role="tab"
          aria-selected={active === section.id}
          aria-controls={`this-pc-panel-${section.id}`}
          className={active === section.id ? 'is-active' : undefined}
          onClick={() => onChange(section.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          <section.icon aria-hidden="true" />
          <span>{section.label}</span>
        </button>
      ))}
    </div>
  );
}

function EvidenceSpine({
  snapshotReady,
  exposureReady,
  internetReady,
  onChange,
}: {
  snapshotReady: boolean;
  exposureReady: boolean;
  internetReady: boolean;
  onChange: (view: DeviceView) => void;
}) {
  const steps = [
    { label: 'Device', icon: Monitor, ready: snapshotReady, view: 'overview' as const },
    { label: 'Interfaces', icon: Network, ready: snapshotReady, view: 'overview' as const },
    { label: 'Exposure', icon: ShieldCheck, ready: exposureReady, view: 'listeners' as const },
    { label: 'Internet', icon: Globe2, ready: internetReady, view: 'benchmark' as const },
  ];
  return (
    <ol className="this-pc-evidence-spine" aria-label="Evidence path">
      {steps.map((step, index) => (
        <li key={step.label}>
          <button type="button" onClick={() => onChange(step.view)}>
            <step.icon aria-hidden="true" />
            <span>{step.label}</span>
            <i className={step.ready ? 'is-ready' : undefined} aria-hidden="true" />
            <span className="sr-only">{step.ready ? 'Observed' : 'Not observed'}</span>
          </button>
          {index < steps.length - 1 ? <ArrowRight aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

export function ThisDeviceRoute() {
  const [view, setView] = useState<DeviceView>('overview');
  const { capabilities, snapshot, loadSnapshot } = useDeviceCapabilities();
  const actions = useDeviceActions(capabilities);
  const quality = useQualityPlan(() => setView('benchmark'));
  const snapshotReady = snapshot.status === 'ready';
  const exposureReady = actions.activity.status === 'ready';
  const internetReady = actions.publicIdentity.status === 'ready' || quality.stage === 'finished';
  const currentSection = sectionViews.find((section) => section.id === view) ?? sectionViews[0];

  return (
    <div className="this-pc-page">
      <div className="this-pc-page-inner">
        <header className="this-pc-hero">
          <div>
            <h1>This Device</h1>
            <p>See what this machine exposes — and how it reaches the internet.</p>
          </div>
          <div>
            <button
              type="button"
              className="this-pc-button this-pc-refresh"
              disabled={snapshot.status === 'loading'}
              onClick={loadSnapshot}
            >
              <RefreshCw aria-hidden="true" />
              {snapshot.status === 'loading' ? 'Reading local snapshot…' : 'Refresh local snapshot'}
            </button>
            <small>Captures state once. Nothing runs in background.</small>
          </div>
        </header>

        <EvidenceSpine
          snapshotReady={snapshotReady}
          exposureReady={exposureReady}
          internetReady={internetReady}
          onChange={setView}
        />
        <p className="this-pc-perspective-note">
          Device, interface, exposure, and public-IP evidence describe the ProtoPeek process/network
          namespace. A benchmark measures this browser's selected network path, which can differ
          under containers, proxies, VPNs, or remote browsing.
        </p>
        <DeviceSummary snapshot={snapshot} />
        {capabilities.status === 'error' ? (
          <section
            className="this-pc-unavailable"
            role="alert"
            aria-labelledby="this-pc-unavailable-title"
          >
            <CircleAlert aria-hidden="true" />
            <div>
              <h2 id="this-pc-unavailable-title">This Device is unavailable in this runtime</h2>
              <p>{capabilities.error}</p>
              <small>
                ProtoPeek will not offer a browser-only benchmark here because it could be mistaken
                for evidence about the host process/network namespace.
              </small>
            </div>
          </section>
        ) : capabilities.status === 'loading' ? (
          <section className="this-pc-unavailable is-loading" role="status">
            <RefreshCw aria-hidden="true" />
            <div>
              <h2>Confirming the local capability boundary</h2>
              <p>
                Benchmark and inspection actions remain unavailable until the local backend
                responds.
              </p>
            </div>
          </section>
        ) : (
          <>
            <DeviceSectionTabs active={view} onChange={setView} />

            <section
              id={`this-pc-panel-${view}`}
              role="tabpanel"
              aria-labelledby={`this-pc-tab-${view}`}
              className="this-pc-view"
            >
              {view === 'overview' ? (
                <div className="this-pc-overview-grid">
                  <div className="this-pc-stack">
                    <InterfacesPanel snapshot={snapshot} />
                    {snapshot.status === 'ready' && snapshot.value.notes.length ? (
                      <aside className="this-pc-notes">
                        {snapshot.value.notes.map((note) => (
                          <p key={note}>{note}</p>
                        ))}
                      </aside>
                    ) : null}
                  </div>
                  <aside className="this-pc-stack">
                    <PublicAddressPanel
                      capabilities={capabilities}
                      state={actions.publicIdentity}
                      consentOpen={actions.publicConsent}
                      acknowledged={actions.publicAcknowledged}
                      families={actions.publicFamilies}
                      onOpen={actions.openPublicConsent}
                      onAcknowledged={actions.setPublicAcknowledged}
                      onFamilies={actions.setPublicFamilies}
                      onConfirm={actions.checkPublicIdentity}
                      onCancel={() => actions.setPublicConsent(false)}
                    />
                    <QualityPlanSummary onOpen={quality.openPlan} />
                    <EvidenceBoundaries />
                  </aside>
                </div>
              ) : view === 'listeners' ? (
                <SocketsPanel
                  kind="listeners"
                  capabilities={capabilities}
                  activity={actions.activity}
                  consentOpen={actions.activityConsent && actions.activityPurpose === 'listeners'}
                  acknowledged={actions.activityAcknowledged}
                  onOpen={() => actions.openActivityConsent('listeners')}
                  onAcknowledged={actions.setActivityAcknowledged}
                  onConfirm={actions.inspectActivity}
                  onCancel={() => actions.setActivityConsent(false)}
                />
              ) : view === 'activity' ? (
                <div className="this-pc-stack">
                  <SocketsPanel
                    kind="connections"
                    capabilities={capabilities}
                    activity={actions.activity}
                    consentOpen={
                      actions.activityConsent && actions.activityPurpose === 'connections'
                    }
                    acknowledged={actions.activityAcknowledged}
                    onOpen={() => actions.openActivityConsent('connections')}
                    onAcknowledged={actions.setActivityAcknowledged}
                    onConfirm={actions.inspectActivity}
                    onCancel={() => actions.setActivityConsent(false)}
                  />
                  <InterfaceLoadPanel
                    capabilities={capabilities}
                    state={actions.traffic}
                    duration={actions.trafficDuration}
                    onDuration={actions.setTrafficDuration}
                    onSample={actions.sampleTraffic}
                  />
                </div>
              ) : (
                <QualityPlanPanel
                  stage={quality.stage}
                  summary={quality.summary}
                  phase={quality.phase}
                  message={quality.message}
                  profileID={quality.profile}
                  uploadEnabled={quality.uploadEnabled}
                  acknowledged={quality.acknowledged}
                  onOpen={quality.openPlan}
                  onProfile={quality.setProfile}
                  onUpload={quality.setUploadEnabled}
                  onAcknowledged={quality.setAcknowledged}
                  onStart={() => void quality.startPlan()}
                  onCancel={quality.cancelPlan}
                  onStop={quality.stopPlan}
                />
              )}
            </section>

            <footer className="this-pc-footer">
              <span>
                <b>Observed</b>
                {snapshot.status === 'ready'
                  ? formatObservedAt(snapshot.value.observedAt)
                  : 'Not available'}
              </span>
              <span>
                <b>Scope</b>
                Local process/network namespace
              </span>
              <span>
                <b>Limitations</b>
                Local view only. No guarantee of completeness.
              </span>
            </footer>
          </>
        )}
      </div>
      {capabilities.status === 'ready' ? (
        <DeviceSectionTabs active={view} onChange={setView} mobile />
      ) : null}
      <span className="sr-only" aria-live="polite">
        Current section: {currentSection.label}
      </span>
    </div>
  );
}
