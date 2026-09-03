import { LoaderCircle, LockKeyhole, Play, X } from 'lucide-react';
import { type ReactNode, useContext } from 'react';
import type { ScanResult } from '@/console/api';
import { DiscoveryPanel } from '@/console/DiscoveryScanner';
import { ProtocolShellContext } from '@/console/ProtocolShellContext';
import { ProtoPeekMark } from '@/console/ProtoPeekMark';
import { GrpcStatusBanner } from '@/features/grpc/GrpcViewPrimitives';
import { TargetForm } from '@/features/grpc/target/TargetForm';
import type { BrowserProtoFolderSelection } from '@/shared/proto-folder';
import type { BootstrapResponse, WorkspaceTargetProfile } from '@/shared/types';
import { displayBuildVersion, workspaceSchemaSourceLabel } from '@/shared/utils';

type TargetViewProps = {
  targets: WorkspaceTargetProfile[];
  activeTargetId: string;
  draft: WorkspaceTargetProfile;
  browserProtoFolder: BrowserProtoFolderSelection | null;
  browserProtoFolderBusy: boolean;
  busy: boolean;
  error: string | null;
  onChangeDraft: (next: Partial<WorkspaceTargetProfile>) => void;
  onBrowserProtoFolderChange: (selection: BrowserProtoFolderSelection | null) => void;
  onBrowserProtoFolderBusyChange: (busy: boolean) => void;
  onSaveAndConnect: () => void;
  onCancelConnect: () => void;
  onConnect: (target: WorkspaceTargetProfile) => void;
  onEdit: (target: WorkspaceTargetProfile) => void;
  onDelete: (id: string) => void;
  onOpenDiscovered: (result: ScanResult) => void;
};

export function WorkspaceView({
  targets,
  activeTargetId,
  draft,
  browserProtoFolder,
  browserProtoFolderBusy,
  busy,
  error,
  rootBootstrap,
  onChangeDraft,
  onBrowserProtoFolderChange,
  onBrowserProtoFolderBusyChange,
  onSaveAndConnect,
  onCancelConnect,
  onConnect,
  onEdit,
  onDelete,
  onReset,
  onOpenDiscovered,
}: TargetViewProps & {
  rootBootstrap: BootstrapResponse | null;
  onReset: () => void;
}) {
  const protocolShell = useContext(ProtocolShellContext);
  return (
    <div className="space-y-6">
      <DiscoveryPanel onOpenGRPC={onOpenDiscovered} onOpenHTTP={protocolShell?.openHTTPDiscovery} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="pp-heading text-base">Target connection</h3>
          {error ? <GrpcStatusBanner tone="danger" title="Error" description={error} /> : null}
          <TargetForm
            draft={draft}
            browserProtoFolder={browserProtoFolder}
            browserProtoFolderBusy={browserProtoFolderBusy}
            busy={busy}
            onChange={onChangeDraft}
            onBrowserProtoFolderChange={onBrowserProtoFolderChange}
            onBrowserProtoFolderBusyChange={onBrowserProtoFolderBusyChange}
            onSaveAndConnect={onSaveAndConnect}
            onCancelConnect={onCancelConnect}
          />
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="pp-heading text-base">Successful connections</h3>
            {rootBootstrap?.launcherMode ? (
              <button className="pp-button-ghost text-xs" type="button" onClick={onReset}>
                Launcher
              </button>
            ) : null}
          </div>
          {targets.length === 0 ? (
            <div className="text-sm text-pp-muted">No successful connections yet.</div>
          ) : (
            <div className="space-y-2">
              {targets.map((target) => (
                <div key={target.id} className="rounded-lg border border-pp-border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-pp-ink">{target.name}</div>
                      <div className="text-xs text-pp-muted">{target.address}</div>
                    </div>
                    {target.id === activeTargetId ? (
                      <span className="pp-badge text-pp-ok">Active</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="pp-badge">
                      {workspaceSchemaSourceLabel(target.schemaSource)}
                    </span>
                    <span className="pp-badge">{target.plaintext ? 'Plain' : 'TLS'}</span>
                    {target.insecure ? (
                      <span className="pp-badge text-amber-600">Skip verify</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="pp-button-primary py-1 text-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => onConnect(target)}
                    >
                      {busy ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : (
                        <Play className="size-3" />
                      )}
                      {target.schemaSource === 'browser-proto-folder' ? 'Repick folder' : 'Connect'}
                    </button>
                    <button
                      className="pp-button-secondary py-1 text-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => onEdit(target)}
                    >
                      Edit
                    </button>
                    <button
                      className="pp-button-ghost py-1 text-xs"
                      type="button"
                      aria-label={`Delete ${target.name}`}
                      disabled={busy}
                      onClick={() => onDelete(target.id)}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LauncherView({
  bootstrap,
  discoveryAutoStart,
  notices,
  targets,
  activeTargetId,
  draft,
  browserProtoFolder,
  browserProtoFolderBusy,
  busy,
  error,
  onChangeDraft,
  onBrowserProtoFolderChange,
  onBrowserProtoFolderBusyChange,
  onSaveAndConnect,
  onCancelConnect,
  onConnect,
  onEdit,
  onDelete,
  onOpenDiscovered,
}: TargetViewProps & {
  bootstrap: BootstrapResponse;
  discoveryAutoStart: boolean;
  notices?: ReactNode;
}) {
  const protocolShell = useContext(ProtocolShellContext);
  return (
    <div className="pp-launcher">
      <header className="pp-launcher-header">
        <div className="pp-wordmark">
          <span className="pp-wordmark-icon">
            <ProtoPeekMark />
          </span>
          <span>ProtoPeek</span>
          <span className="pp-version">{displayBuildVersion(bootstrap.version)}</span>
        </div>
        <span className="pp-local-indicator">
          <LockKeyhole aria-hidden="true" /> Local console
        </span>
      </header>
      {notices}
      <div className="pp-launcher-main">
        <section className="pp-launcher-intro">
          <span className="pp-kicker">gRPC workbench</span>
          <h1>Open a gRPC target.</h1>
          <p>Reflection first. Browser folders or host descriptors when it is off.</p>
          <div className="pp-trust-row">
            <span>Auto-find loopback services</span>
            <span>
              <LockKeyhole aria-hidden="true" /> No account, cloud, or database
            </span>
          </div>
        </section>

        <section className="pp-launcher-card" aria-labelledby="connect-title">
          <div className="pp-card-heading">
            <div>
              <span className="pp-kicker">New session</span>
              <h2 id="connect-title">Connect a target</h2>
            </div>
            <span className="pp-reflection-chip">Reflection ready</span>
          </div>
          {error ? (
            <GrpcStatusBanner tone="danger" title="Connection failed" description={error} />
          ) : null}
          <TargetForm
            draft={draft}
            browserProtoFolder={browserProtoFolder}
            browserProtoFolderBusy={browserProtoFolderBusy}
            busy={busy}
            onChange={onChangeDraft}
            onBrowserProtoFolderChange={onBrowserProtoFolderChange}
            onBrowserProtoFolderBusyChange={onBrowserProtoFolderBusyChange}
            onSaveAndConnect={onSaveAndConnect}
            onCancelConnect={onCancelConnect}
          />
        </section>

        <DiscoveryPanel
          autoStart={discoveryAutoStart}
          initialTarget={bootstrap.initialScanTarget}
          onOpenGRPC={onOpenDiscovered}
          onOpenHTTP={protocolShell?.openHTTPDiscovery}
        />

        <section className="pp-saved-targets" aria-labelledby="saved-targets-title">
          <div className="pp-card-heading">
            <div>
              <span className="pp-kicker">Recent</span>
              <h2 id="saved-targets-title">Successful connections</h2>
            </div>
            <span className="pp-version">{targets.length} recent</span>
          </div>
          {targets.length === 0 ? (
            <div className="pp-launcher-empty">
              A target appears here only after it connects successfully.
            </div>
          ) : (
            <div className="pp-target-list">
              {targets.map((target) => (
                <div key={target.id} className="pp-target-row">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-pp-ink">{target.name}</div>
                      <div className="text-xs text-pp-muted">{target.address}</div>
                    </div>
                    {target.id === activeTargetId ? (
                      <span className="pp-badge text-pp-ok">Active</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="pp-badge">
                      {workspaceSchemaSourceLabel(target.schemaSource)}
                    </span>
                    <span className="pp-badge">{target.plaintext ? 'Plain' : 'TLS'}</span>
                    {target.insecure ? (
                      <span className="pp-badge text-amber-600">Skip verify</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="pp-button-primary py-1 text-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => onConnect(target)}
                    >
                      {busy ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : (
                        <Play className="size-3" />
                      )}
                      {target.schemaSource === 'browser-proto-folder' ? 'Repick folder' : 'Connect'}
                    </button>
                    <button
                      className="pp-button-secondary py-1 text-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => onEdit(target)}
                    >
                      Edit
                    </button>
                    <button
                      className="pp-button-ghost py-1 text-xs"
                      type="button"
                      aria-label={`Delete ${target.name}`}
                      disabled={busy}
                      onClick={() => onDelete(target.id)}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <footer className="pp-launcher-footer">
        Workspace preferences stay in this browser. Selected schema snapshots go only to this
        running ProtoPeek instance, never to the gRPC target.
      </footer>
    </div>
  );
}
