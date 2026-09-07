import { Activity, CircleAlert, Gauge, Monitor, Radio, RefreshCw, Timer } from 'lucide-react';
import { type KeyboardEvent, useContext, useState } from 'react';
import { ProtocolInfo } from '@/console/ProtocolInfo';
import { ProtocolShellContext } from '@/console/ProtocolShellContext';
import type { ThisPCSocket } from '@/console/this-pc-api';

import { DeviceSummary } from './DeviceSummary';
import { formatObservedAt } from './device-format';
import type { DeviceView } from './device-state';
import { InterfaceLoadPanel } from './InterfaceLoadPanel';
import { InterfacesPanel } from './InterfacesPanel';
import { createListenerHandoff, type ListenerHandoffKind } from './listener-handoff';
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
  { id: 'traffic', label: 'Traffic', icon: Timer },
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
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? sectionViews.length - 1
          : (current + direction + sectionViews.length) % sectionViews.length;
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
    <div
      className="this-pc-tabs"
      role="tablist"
      aria-label="This Device sections"
      aria-orientation="vertical"
    >
      {sectionViews.map((section, index) => (
        <button
          key={section.id}
          id={`this-pc-tab-${section.id}`}
          type="button"
          role="tab"
          aria-selected={active === section.id}
          tabIndex={active === section.id ? 0 : -1}
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

export function ThisDeviceRoute() {
  const shell = useContext(ProtocolShellContext);
  const [view, setView] = useState<DeviceView>('overview');
  const [handoffError, setHandoffError] = useState('');
  const { capabilities, snapshot, loadSnapshot } = useDeviceCapabilities();
  const actions = useDeviceActions(capabilities);
  const quality = useQualityPlan(() => setView('benchmark'));
  const currentSection = sectionViews.find((section) => section.id === view) ?? sectionViews[0];

  function openListenerHandoff(socket: ThisPCSocket, kind: ListenerHandoffKind) {
    if (!shell || actions.activity.status !== 'ready') {
      setHandoffError('This workbench cannot accept the listener draft.');
      return;
    }
    const handoff = createListenerHandoff(socket, actions.activity.value.observedAt, kind);
    if (!handoff.ok) {
      setHandoffError(handoff.error);
      return;
    }
    const stored = shell.openHandoff(handoff.value);
    setHandoffError(stored.ok ? '' : stored.error);
  }

  return (
    <div className="this-pc-page">
      <div className="this-pc-page-inner">
        <header className="this-pc-hero">
          <div>
            <h1>This Device</h1>
            <ProtocolInfo protocol="device" />
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
          </div>
        </header>

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
          <div className="this-pc-section-layout">
            <DeviceSectionTabs active={view} onChange={setView} />

            <section
              id={`this-pc-panel-${view}`}
              role="tabpanel"
              aria-labelledby={`this-pc-tab-${view}`}
              className="this-pc-view"
            >
              {view === 'overview' ? (
                <>
                  <DeviceSummary snapshot={snapshot} />
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
                </>
              ) : view === 'listeners' ? (
                <SocketsPanel
                  kind="listeners"
                  capabilities={capabilities}
                  activity={actions.activity}
                  handoffError={handoffError}
                  onOpen={() => {
                    setHandoffError('');
                    actions.inspectActivity();
                  }}
                  onCancel={actions.cancelActivity}
                  onHandoff={shell ? openListenerHandoff : undefined}
                />
              ) : view === 'activity' ? (
                <div className="this-pc-stack">
                  <SocketsPanel
                    kind="connections"
                    capabilities={capabilities}
                    activity={actions.activity}
                    onOpen={actions.inspectActivity}
                    onCancel={actions.cancelActivity}
                  />
                </div>
              ) : view === 'traffic' ? (
                <InterfaceLoadPanel
                  capabilities={capabilities}
                  state={actions.traffic}
                  duration={actions.trafficDuration}
                  onDuration={actions.setTrafficDuration}
                  onSample={actions.sampleTraffic}
                />
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
                {(view === 'listeners' || view === 'activity') &&
                actions.activity.status === 'ready'
                  ? formatObservedAt(actions.activity.value.observedAt)
                  : snapshot.status === 'ready'
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
          </div>
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
