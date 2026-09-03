import { CircleAlert, LoaderCircle } from 'lucide-react';
import { CallWorkspace } from '@/console/CallWorkspace';
import { CommandPalette } from '@/console/CommandPalette';
import { ServiceNavigator } from '@/console/ServiceNavigator';
import { WorkbenchHeader } from '@/console/WorkbenchHeader';
import { classNames, prettyJson } from '@/shared/utils';
import { ChecksView } from './checks/ChecksView';
import { GrpcStatusBanner } from './GrpcViewPrimitives';
import { HistoryView } from './history/HistoryView';
import { TransportView } from './response/TransportView';
import { SchemaView } from './schema/SchemaView';
import { LauncherView, WorkspaceView } from './target/TargetViews';
import { downloadFile } from './workspace/model';
import type { GrpcWorkbenchModel } from './workspace/useGrpcWorkbench';

export function GrpcWorkbenchView({ model }: { model: GrpcWorkbenchModel }) {
  const {
    status,
    shell,
    notices,
    request,
    invoke,
    repeat,
    health,
    evidence,
    proto,
    targets,
    actions,
  } = model;
  const { bootstrap, bootError, schema, currentMethod, currentService } = status;

  const workspaceNotices = (
    <>
      {notices.recoveries.length > 0 ? (
        <div className="px-4 pt-4">
          <GrpcStatusBanner
            tone="danger"
            title="Workspace storage needs recovery"
            description={`${notices.recoveries.map((recovery) => `${recovery.section}: ${recovery.reason}`).join(' ')} Original keys remain untouched. Download captures exact readable originals; a browser read failure can only be left in place. Accept the bounded valid records explicitly after reviewing the recovery, which may contain credentials, request bodies, and host paths.`}
            actions={[
              { label: 'Download originals', run: notices.downloadRecovery },
              { label: 'Use recovered data', run: notices.useRecoveredWorkspace },
            ]}
          />
        </div>
      ) : null}

      {notices.operationMessage ? (
        <div className="px-4 pt-4">
          <GrpcStatusBanner
            tone={notices.operationMessage.tone}
            title={notices.operationMessage.title}
            description={notices.operationMessage.description}
            actions={notices.operationMessage.actions}
            onDismiss={notices.dismiss}
          />
        </div>
      ) : null}
    </>
  );

  if (bootError) {
    return (
      <div className="flex h-screen items-center justify-center bg-pp-bg">
        <div className="pp-panel max-w-md text-center">
          <CircleAlert className="mx-auto mb-3 size-8 text-pp-danger" />
          <h1 className="pp-heading text-xl">ProtoPeek couldn&apos;t start</h1>
          <p className="pp-muted mt-2">{bootError}</p>
        </div>
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="flex h-screen items-center justify-center bg-pp-bg">
        <div className="flex items-center gap-3">
          <LoaderCircle className="size-5 animate-spin text-pp-brand" />
          <span className="text-sm text-pp-muted">Loading ProtoPeek...</span>
        </div>
      </div>
    );
  }

  if (bootstrap.launcherMode && bootstrap.services.length === 0) {
    return (
      <LauncherView
        bootstrap={bootstrap}
        discoveryAutoStart={targets.discoveryAutoStart}
        notices={workspaceNotices}
        targets={targets.items}
        activeTargetId={targets.activeTargetId}
        draft={targets.draft}
        browserProtoFolder={targets.browserProtoFolder}
        browserProtoFolderBusy={targets.browserProtoFolderBusy}
        busy={targets.busy}
        error={targets.error}
        onChangeDraft={targets.updateDraft}
        onBrowserProtoFolderChange={targets.changeBrowserProtoFolder}
        onBrowserProtoFolderBusyChange={targets.setBrowserProtoFolderBusy}
        onSaveAndConnect={() => void targets.saveAndConnect()}
        onCancelConnect={targets.cancelConnection}
        onConnect={(target) => void targets.connectRecent(target)}
        onEdit={targets.editTarget}
        onDelete={targets.deleteTarget}
        onOpenDiscovered={(result) => void targets.openDiscovered(result)}
      />
    );
  }

  if (!schema || !currentMethod || !currentService) {
    return (
      <div className="flex h-screen items-center justify-center bg-pp-bg">
        <div className="flex items-center gap-3">
          <LoaderCircle className="size-5 animate-spin text-pp-brand" />
          <span className="text-sm text-pp-muted">Loading schema...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pp-shell">
      {shell.sidebarOpen ? (
        <button
          type="button"
          aria-label="Close service navigation"
          className="pp-sidebar-backdrop"
          onClick={() => shell.setSidebarOpen(false)}
        />
      ) : null}
      <aside className={classNames('pp-sidebar', shell.sidebarOpen && 'pp-sidebar-open')}>
        <ServiceNavigator
          services={shell.visibleServices}
          selectedMethod={currentMethod.fullName}
          searchText={shell.searchText}
          filter={shell.methodFilter}
          activeView={shell.activeView}
          historyCount={evidence.history.length}
          savedCount={evidence.collections.length}
          onSearchChange={shell.setSearchText}
          onFilterChange={shell.setMethodFilter}
          onSelectMethod={actions.selectMethod}
          onViewChange={(view) => {
            actions.navigateToView(view);
            shell.setSidebarOpen(false);
          }}
          onExport={actions.exportWorkspace}
          onImport={() => shell.importInputRef.current?.click()}
        />
        <input
          ref={shell.importInputRef}
          className="hidden"
          type="file"
          accept="application/json"
          onChange={(event) => void actions.importWorkspace(event)}
        />
      </aside>

      <div className="pp-main">
        <WorkbenchHeader
          target={bootstrap.target}
          targetProfile={shell.activeTarget}
          serviceName={currentService.name}
          method={currentMethod}
          sidebarButtonRef={shell.sidebarToggleRef}
          sidebarOpen={shell.sidebarOpen}
          onOpenSidebar={() => shell.setSidebarOpen(true)}
          onOpenCommandPalette={() => shell.setCommandPaletteOpen(true)}
          onSwitchTarget={() => {
            if (targets.rootBootstrap?.launcherMode) targets.resetToLauncher();
            else actions.navigateToView('workspace');
          }}
        />

        {workspaceNotices}

        <div
          className={classNames(
            'flex-1 overflow-y-auto',
            shell.activeView === 'compose' ? 'p-0' : 'p-4'
          )}
        >
          {shell.activeView === 'compose' ? (
            <CallWorkspace
              method={currentMethod}
              schema={schema}
              requestText={request.requestText}
              onRequestChange={request.setRequestText}
              timeoutSeconds={request.timeoutSeconds}
              onTimeoutChange={request.setTimeoutSeconds}
              metadata={request.metadata}
              onAddMetadata={request.addMetadata}
              onRemoveMetadata={request.removeMetadata}
              onMetadataChange={request.changeMetadata}
              onInvoke={actions.invokeCurrent}
              onCancel={invoke.cancel}
              onSaveRequest={actions.saveCollection}
              onResetRequest={actions.resetRequestFromSchema}
              invokeState={invoke.state}
            />
          ) : null}

          {shell.activeView === 'history' ? (
            <HistoryView
              history={evidence.history}
              collections={evidence.collections}
              onApply={actions.applyHistory}
              onApplyCollection={actions.applyCollection}
            />
          ) : null}

          {shell.activeView === 'tests' ? (
            <ChecksView
              healthService={health.service}
              onHealthServiceChange={health.setService}
              selectedHealthService={currentService.name}
              healthServiceSuggestions={health.catalog.serviceSuggestions}
              healthCheckDeadlineSeconds={health.checkDeadlineSeconds}
              onHealthCheckDeadlineChange={health.setCheckDeadlineSeconds}
              healthWatchDurationSeconds={health.watchDurationSeconds}
              onHealthWatchDurationChange={health.setWatchDurationSeconds}
              healthRun={health.run}
              healthBusy={health.busy}
              healthBlockedBy={
                repeat.busy
                  ? 'Cancel Repeat first to use Health.'
                  : invoke.state.loading
                    ? 'Cancel the active RPC first to use Health.'
                    : targets.busy
                      ? 'Wait for the target connection to settle.'
                      : null
              }
              healthError={health.error}
              healthAdvertised={health.catalog.advertised}
              currentHealthContextKey={health.contextKey}
              currentTarget={bootstrap.target}
              onHealthCheck={() => void actions.startHealth('check')}
              onHealthWatch={() => void actions.startHealth('watch')}
              onCancelHealth={() => health.cancel('user-cancelled')}
              rules={evidence.assertionRules}
              results={invoke.assertionResults}
              onChangeRule={actions.changeAssertion}
              onAddRule={actions.addAssertion}
              onRemoveRule={actions.removeAssertion}
              onRunAssertions={() =>
                void actions.invokeCurrent().then(() => actions.navigateToView('tests'))
              }
              method={currentMethod}
              repeatConfig={repeat.config}
              setRepeatConfig={repeat.setConfig}
              repeatRun={repeat.run}
              repeatBusy={repeat.busy}
              repeatError={repeat.error}
              repeatProgress={repeat.progress}
              onRepeat={() => void actions.startRepeat()}
              onCancelRepeat={repeat.cancel}
              onExportRepeat={actions.exportRepeat}
              repeatLatencySparkline={repeat.latencySparkline}
              passingAssertions={evidence.passingAssertions}
            />
          ) : null}

          {shell.activeView === 'transport' ? (
            <TransportView
              bootstrap={bootstrap}
              schema={schema}
              method={currentMethod}
              invokeResult={invoke.state.result}
              responsePayload={evidence.responsePayload}
            />
          ) : null}

          {shell.activeView === 'structure' ? (
            <SchemaView
              catalog={proto.catalog}
              searchText={proto.searchText}
              onSearchChange={proto.setSearchText}
              selectedFile={proto.selectedFile}
              onSelectFile={proto.setSelectedFile}
              selectedProto={proto.selectedProto}
              showWellKnown={proto.showWellKnown}
              onToggleWellKnown={proto.setShowWellKnown}
              visibleFiles={proto.filteredFiles}
              onExportCatalog={() =>
                downloadFile(
                  'protopeek-catalog.json',
                  prettyJson(proto.catalog ?? { files: [] }),
                  'application/json'
                )
              }
              onExportProto={(file) =>
                downloadFile(file.name.split('/').pop() || 'schema.proto', file.protoText)
              }
            />
          ) : null}

          {shell.activeView === 'workspace' ? (
            <WorkspaceView
              targets={targets.items}
              activeTargetId={targets.activeTargetId}
              draft={targets.draft}
              browserProtoFolder={targets.browserProtoFolder}
              browserProtoFolderBusy={targets.browserProtoFolderBusy}
              busy={targets.busy}
              error={targets.error}
              rootBootstrap={targets.rootBootstrap}
              onChangeDraft={targets.updateDraft}
              onBrowserProtoFolderChange={targets.changeBrowserProtoFolder}
              onBrowserProtoFolderBusyChange={targets.setBrowserProtoFolderBusy}
              onSaveAndConnect={() => void targets.saveAndConnect()}
              onCancelConnect={targets.cancelConnection}
              onConnect={(target) => void targets.connectRecent(target)}
              onEdit={targets.editTarget}
              onDelete={targets.deleteTarget}
              onReset={targets.resetToLauncher}
              onOpenDiscovered={(result) => void targets.openDiscovered(result)}
            />
          ) : null}
        </div>
      </div>
      <CommandPalette
        open={shell.commandPaletteOpen}
        actions={shell.paletteActions}
        onClose={() => shell.setCommandPaletteOpen(false)}
      />
    </div>
  );
}
