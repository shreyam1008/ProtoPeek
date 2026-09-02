import {
  ArchiveRestore,
  CheckCircle2,
  Eye,
  HardDriveDownload,
  Keyboard,
  LayoutPanelLeft,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type AppearanceMode,
  type AppearancePalette,
  defaultAppearancePreference,
} from '@/shared/theme';

import { defaultInterfacePreferences, type InterfaceDensity } from './interface-preferences';
import { useProtocolShell } from './ProtocolShellContext';
import {
  fetchTransferSnapshot,
  type GoBarryMigrationPreview,
  importGoBarryState,
  previewGoBarryMigration,
  rollbackGoBarryState,
  saveTransferHostConfig,
  type TransferHealthStatus,
  type TransferHostConfig,
  type TransferHostConfigPatch,
  type TransferSnapshot,
} from './transfer-api';
import './suite-pages.css';
import './settings.css';

const appearanceModeOptions: Array<{ value: AppearanceMode; label: string; detail: string }> = [
  { value: 'system', label: 'System', detail: 'Follow this operating system as it changes.' },
  { value: 'light', label: 'Light', detail: 'Use the selected palette’s light pair.' },
  { value: 'dark', label: 'Dark', detail: 'Use the selected palette’s dark pair.' },
];

const paletteOptions: Array<{
  value: AppearancePalette;
  label: string;
  detail: string;
}> = [
  {
    value: 'graphite',
    label: 'Graphite',
    detail: 'Neutral workbench surfaces and clear blue focus.',
  },
  {
    value: 'protopeek',
    label: 'ProtoPeek',
    detail: 'Blue-gray surfaces with a restrained teal signal.',
  },
  { value: 'nord', label: 'Nord', detail: 'Cool blue-charcoal surfaces and frost accents.' },
  {
    value: 'solarized',
    label: 'Solarized',
    detail: 'Warm paper or deep blue-green with teal evidence.',
  },
  {
    value: 'high-contrast',
    label: 'High Contrast',
    detail: 'Strong boundaries, text, and focus in either mode.',
  },
];

const densities: Array<{ value: InterfaceDensity; label: string; detail: string }> = [
  {
    value: 'comfortable',
    label: 'Comfortable',
    detail: 'More space inside route rows and controls.',
  },
  { value: 'compact', label: 'Compact', detail: 'Tighter route rows without resizing app chrome.' },
];

const editableHostStatuses = new Set<TransferHealthStatus>(['stopped', 'failed', 'binary_missing']);

export function Settings() {
  const { appearance, setAppearance, interfacePreferences, setInterfacePreferences } =
    useProtocolShell();
  const [notice, setNotice] = useState('');
  const [hostSnapshot, setHostSnapshot] = useState<TransferSnapshot | null>(null);
  const [hostDraft, setHostDraft] = useState<TransferHostConfig | null>(null);
  const [hostLoading, setHostLoading] = useState(true);
  const [hostSnapshotConfirmed, setHostSnapshotConfirmed] = useState(false);
  const [hostBusy, setHostBusy] = useState<'reload' | 'save' | ''>('');
  const [hostError, setHostError] = useState('');
  const [migrationPreview, setMigrationPreview] = useState<GoBarryMigrationPreview | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState('');
  const [importPreferences, setImportPreferences] = useState(true);
  const [importSession, setImportSession] = useState(true);
  const [preservationAccepted, setPreservationAccepted] = useState(false);
  const [rollbackAccepted, setRollbackAccepted] = useState(false);
  const mountedRef = useRef(true);

  const refreshHostSettings = useCallback(async (signal?: AbortSignal) => {
    setHostLoading(true);
    setHostError('');
    setHostSnapshotConfirmed(false);
    try {
      const snapshot = await fetchTransferSnapshot(signal);
      if (!mountedRef.current || signal?.aborted) return;
      setHostSnapshot(snapshot);
      setHostDraft(snapshot.config);
      setHostSnapshotConfirmed(true);
    } catch (cause) {
      if (!mountedRef.current || signal?.aborted) return;
      setHostSnapshotConfirmed(false);
      const message = cause instanceof Error ? cause.message : 'Host settings could not be loaded.';
      setHostError(message);
      throw cause;
    } finally {
      if (mountedRef.current && !signal?.aborted) setHostLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void refreshHostSettings(controller.signal).catch(() => undefined);
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [refreshHostSettings]);

  function setDensity(density: InterfaceDensity) {
    setNotice('');
    setInterfacePreferences({ ...interfacePreferences, density });
  }

  function setKeyboardHints(showKeyboardHints: boolean) {
    setNotice('');
    setInterfacePreferences({ ...interfacePreferences, showKeyboardHints });
  }

  function restoreDefaults() {
    setAppearance(defaultAppearancePreference);
    setInterfacePreferences(defaultInterfacePreferences);
    setNotice('Interface defaults restored.');
  }

  function updateHostDraft<K extends keyof TransferHostConfig>(
    field: K,
    value: TransferHostConfig[K]
  ) {
    setHostDraft((current) => (current ? { ...current, [field]: value } : current));
    setHostError('');
    setNotice('');
  }

  async function saveHostSettings() {
    if (!hostDraft || !hostSnapshot || hostBusy) return;
    if (!hostSnapshotConfirmed) {
      setHostError(
        'Reload the local transfer snapshot until the host is confirmed before changing host settings.'
      );
      return;
    }
    if (!editableHostStatuses.has(hostSnapshot.health.status)) {
      setHostError(
        hostSnapshot.health.status === 'unavailable'
          ? 'Reload the local transfer snapshot until the host is confirmed stopped before changing host settings.'
          : hostSnapshot.health.status === 'locked'
            ? 'Another ProtoPeek process owns the Downloader; reload after it releases the engine.'
            : 'Stop the Downloader before changing host settings.'
      );
      return;
    }
    const patch = buildHostConfigPatch(hostSnapshot.config, hostDraft);
    setHostBusy('save');
    setHostError('');
    setNotice('');
    try {
      const saved = await saveTransferHostConfig(hostSnapshot.configRevision, patch);
      if (mountedRef.current) {
        setHostDraft(saved);
        setHostSnapshot((current) =>
          current ? { ...current, config: saved, configRevision: saved.configRevision } : current
        );
      }
      try {
        await refreshHostSettings();
        setNotice(
          saved.warning
            ? `Host settings saved with a durability warning: ${saved.warning}`
            : 'Host settings saved and reloaded from the local transfer snapshot.'
        );
      } catch {
        setNotice(
          saved.warning
            ? `Host settings were saved with a durability warning. Reload the snapshot to confirm current host state: ${saved.warning}`
            : 'Host settings were saved. Reload the snapshot to confirm current host state.'
        );
      }
    } catch (cause) {
      setHostError(cause instanceof Error ? cause.message : 'Host settings could not be saved.');
    } finally {
      setHostBusy('');
    }
  }

  async function checkGoBarryState() {
    if (migrationBusy) return;
    setMigrationBusy(true);
    setMigrationError('');
    try {
      const preview = await previewGoBarryMigration();
      setMigrationPreview(preview);
      setImportPreferences(preview.preferencesFound);
      setImportSession(preview.sessionFound);
      setPreservationAccepted(false);
      setRollbackAccepted(false);
    } catch (cause) {
      setMigrationPreview(null);
      setMigrationError(
        cause instanceof Error ? cause.message : 'GoBarryGo state could not be inspected.'
      );
    } finally {
      setMigrationBusy(false);
    }
  }

  async function importGoBarry() {
    if (
      migrationBusy ||
      !migrationPreview ||
      !preservationAccepted ||
      (!importPreferences && !importSession)
    ) {
      return;
    }
    setMigrationBusy(true);
    setMigrationError('');
    try {
      const result = await importGoBarryState({
        importPreferences,
        importSession,
        expectedRevision: migrationPreview.previewRevision,
      });
      const successMessage = result.message || 'GoBarryGo state imported into ProtoPeek.';
      setNotice(successMessage);
      setMigrationPreview(null);
      setPreservationAccepted(false);
      setRollbackAccepted(false);
      try {
        const refreshed = await previewGoBarryMigration();
        setMigrationPreview(refreshed);
      } catch {
        setMigrationError(
          'Import succeeded, but current migration state could not be reloaded. Check again before another migration action.'
        );
      }
      try {
        await refreshHostSettings();
      } catch {
        setNotice(
          `${successMessage} The host snapshot could not be reloaded; reload it before changing host settings.`
        );
      }
    } catch (cause) {
      setMigrationPreview(null);
      setPreservationAccepted(false);
      setRollbackAccepted(false);
      setMigrationError(
        cause instanceof Error ? cause.message : 'GoBarryGo state could not be imported.'
      );
    } finally {
      setMigrationBusy(false);
    }
  }

  async function rollbackGoBarry() {
    if (migrationBusy || !migrationPreview?.lastReceiptId || !rollbackAccepted) {
      return;
    }
    setMigrationBusy(true);
    setMigrationError('');
    try {
      const result = await rollbackGoBarryState(migrationPreview.lastReceiptId);
      const successMessage =
        result.message || 'ProtoPeek transfer state restored from the migration receipt.';
      setNotice(successMessage);
      setMigrationPreview(null);
      setPreservationAccepted(false);
      setRollbackAccepted(false);
      try {
        const refreshed = await previewGoBarryMigration();
        setMigrationPreview(refreshed);
      } catch {
        setMigrationError(
          'Rollback succeeded, but current migration state could not be reloaded. Check again before another migration action.'
        );
      }
      try {
        await refreshHostSettings();
      } catch {
        setNotice(
          `${successMessage} The host snapshot could not be reloaded; reload it before changing host settings.`
        );
      }
    } catch (cause) {
      setMigrationPreview(null);
      setPreservationAccepted(false);
      setRollbackAccepted(false);
      setMigrationError(
        cause instanceof Error ? cause.message : 'The GoBarryGo migration could not be rolled back.'
      );
    } finally {
      setMigrationBusy(false);
    }
  }

  return (
    <div className="pp-suite-page pp-settings-page">
      <header className="pp-suite-page-heading">
        <div>
          <span className="pp-kicker">Settings</span>
          <h1>Shape this browser&apos;s console.</h1>
          <p>
            Interface preferences stay browser-local. Host/runtime settings come from the local
            snapshot, while migration remains separated, preview-first, and explicit.
          </p>
        </div>
        <span className="pp-settings-local">
          <LockKeyhole aria-hidden="true" /> Local + explicit
        </span>
      </header>

      {notice ? (
        <p className="pp-settings-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="pp-settings-layout">
        <section className="pp-settings-panel" aria-labelledby="appearance-title">
          <header>
            <Monitor aria-hidden="true" />
            <div>
              <h2 id="appearance-title">Appearance</h2>
              <p>Applied immediately and saved in this browser profile.</p>
            </div>
          </header>

          <fieldset className="pp-settings-choice-group">
            <legend>Mode</legend>
            {appearanceModeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={appearance.mode === option.value}
                onClick={() => {
                  setNotice('');
                  setAppearance({ ...appearance, mode: option.value });
                }}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </fieldset>

          <fieldset className="pp-settings-choice-group">
            <legend>Color scheme</legend>
            {paletteOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={appearance.palette === option.value}
                onClick={() => {
                  setNotice('');
                  setAppearance({ ...appearance, palette: option.value });
                }}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </fieldset>

          <fieldset className="pp-settings-choice-group">
            <legend>Interface density</legend>
            {densities.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={interfacePreferences.density === option.value}
                onClick={() => setDensity(option.value)}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </fieldset>
        </section>

        <section className="pp-settings-panel" aria-labelledby="local-preferences-title">
          <header>
            <LayoutPanelLeft aria-hidden="true" />
            <div>
              <h2 id="local-preferences-title">Local preferences</h2>
              <p>Presentation choices only; these do not alter the ProtoPeek host.</p>
            </div>
          </header>

          <label className="pp-settings-toggle">
            <Keyboard aria-hidden="true" />
            <span>
              <strong>Show keyboard shortcut hints</strong>
              <small>Display key labels beside command and workbench actions.</small>
            </span>
            <input
              type="checkbox"
              checked={interfacePreferences.showKeyboardHints}
              onChange={(event) => setKeyboardHints(event.target.checked)}
            />
          </label>

          <div className="pp-settings-boundary">
            <Eye aria-hidden="true" />
            <div>
              <strong>What this page does not control</strong>
              <p>
                CPU, memory, scan authorization, and protocol deadlines remain explicit where they
                are used. Only the reviewed migration card below can copy its allowlisted transfer
                preferences into host state.
              </p>
            </div>
          </div>

          <button type="button" className="pp-settings-reset" onClick={restoreDefaults}>
            <RotateCcw aria-hidden="true" /> Restore interface defaults
          </button>
        </section>

        <HostSettingsPanel
          snapshot={hostSnapshot}
          draft={hostDraft}
          snapshotConfirmed={hostSnapshotConfirmed}
          loading={hostLoading}
          busy={hostBusy}
          error={hostError}
          onReload={() => {
            setHostBusy('reload');
            void refreshHostSettings()
              .catch(() => undefined)
              .finally(() => setHostBusy(''));
          }}
          onSave={() => void saveHostSettings()}
          onChange={updateHostDraft}
        />

        <section
          className="pp-settings-panel pp-settings-migration"
          aria-labelledby="gobarry-migration-title"
        >
          <header>
            <ArchiveRestore aria-hidden="true" />
            <div>
              <h2 id="gobarry-migration-title">Bring GoBarryGo home</h2>
              <p>
                Preview the final GoBarryGo profile, then explicitly copy compatible preferences and
                resumable aria2 session entries into ProtoPeek.
              </p>
            </div>
          </header>

          {!migrationPreview ? (
            <div className="pp-migration-intro">
              <div>
                <strong>No automatic filesystem scan</strong>
                <p>
                  ProtoPeek checks the known local GoBarryGo profile only after you ask. Previewing
                  never starts aria2c and never writes either product&apos;s files. Close GoBarryGo
                  before the final preview/import so its source snapshot stays stable.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void checkGoBarryState()}
                disabled={migrationBusy}
              >
                {migrationBusy ? (
                  <LoaderCircle className="is-spinning" aria-hidden="true" />
                ) : (
                  <HardDriveDownload aria-hidden="true" />
                )}
                Check for GoBarryGo
              </button>
            </div>
          ) : (
            <GoBarryMigrationPanel
              preview={migrationPreview}
              busy={migrationBusy}
              importPreferences={importPreferences}
              importSession={importSession}
              preservationAccepted={preservationAccepted}
              rollbackAccepted={rollbackAccepted}
              onImportPreferences={setImportPreferences}
              onImportSession={setImportSession}
              onPreservationAccepted={setPreservationAccepted}
              onRollbackAccepted={setRollbackAccepted}
              onRefresh={() => void checkGoBarryState()}
              onImport={() => void importGoBarry()}
              onRollback={() => void rollbackGoBarry()}
            />
          )}

          {migrationError ? (
            <p className="pp-settings-migration-error" role="alert">
              <TriangleAlert aria-hidden="true" /> {migrationError}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

type HostSettingsPanelProps = {
  snapshot: TransferSnapshot | null;
  draft: TransferHostConfig | null;
  snapshotConfirmed: boolean;
  loading: boolean;
  busy: 'reload' | 'save' | '';
  error: string;
  onReload: () => void;
  onSave: () => void;
  onChange: <K extends keyof TransferHostConfig>(field: K, value: TransferHostConfig[K]) => void;
};

function HostSettingsPanel({
  snapshot,
  draft,
  snapshotConfirmed,
  loading,
  busy,
  error,
  onReload,
  onSave,
  onChange,
}: HostSettingsPanelProps) {
  const hostStatus = snapshot?.health.status ?? (loading ? 'loading' : 'unavailable');
  const hostSaveBlocked = !snapshotConfirmed || !canEditHostSettings(hostStatus);
  const overwritePolicy = draft?.allowOverwriteExistingFiles
    ? 'overwrite'
    : draft?.autoRenameConflictingFiles
      ? 'rename'
      : 'refuse';

  return (
    <section className="pp-settings-panel pp-settings-host" aria-labelledby="host-settings-title">
      <header>
        <Server aria-hidden="true" />
        <div>
          <h2 id="host-settings-title">Downloader host settings</h2>
          <p>
            Runtime and filesystem controls are read from the local transfer snapshot and saved on
            this host. They are never stored in browser preferences.
          </p>
        </div>
      </header>

      <div className="pp-host-settings-body">
        <div className="pp-host-settings-state" aria-live="polite">
          <div>
            <span className="pp-kicker">Host/runtime state</span>
            <strong>{hostStatus}</strong>
            <small>{snapshot?.health.message || 'Reading the local Downloader state.'}</small>
          </div>
          <span aria-hidden="true" className={snapshot?.health.ready ? 'is-ready' : ''}>
            {hostStatus}
          </span>
        </div>

        {error ? (
          <p className="pp-host-settings-error" role="alert">
            <TriangleAlert aria-hidden="true" /> {error}
          </p>
        ) : null}

        {loading && !draft ? (
          <p className="pp-host-settings-loading" aria-live="polite">
            <LoaderCircle className="is-spinning" aria-hidden="true" /> Loading host settings…
          </p>
        ) : null}

        {draft ? (
          <form
            className="pp-host-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <div className="pp-host-settings-grid">
              <label className="pp-host-settings-wide" htmlFor="host-aria2-path">
                aria2 executable/path
                <input
                  id="host-aria2-path"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4 * 1024}
                  value={draft.aria2Path}
                  onChange={(event) => onChange('aria2Path', event.target.value)}
                />
                <small>Blank uses the system aria2c lookup.</small>
              </label>

              <label className="pp-host-settings-wide" htmlFor="host-download-directory">
                Download directory
                <input
                  id="host-download-directory"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4 * 1024}
                  value={draft.downloadDirectory}
                  onChange={(event) => onChange('downloadDirectory', event.target.value)}
                />
                <small>Use an absolute path that the local process can write.</small>
              </label>

              <label htmlFor="host-active-jobs">
                Active jobs
                <input
                  id="host-active-jobs"
                  type="number"
                  min={1}
                  max={16}
                  step={1}
                  value={draft.maxActiveJobs}
                  onChange={(event) => onChange('maxActiveJobs', numberValue(event.target.value))}
                />
                <small>1–16 simultaneous jobs.</small>
              </label>

              <label htmlFor="host-connections-per-host">
                Connections per host
                <input
                  id="host-connections-per-host"
                  type="number"
                  min={1}
                  max={16}
                  step={1}
                  value={draft.maxConnectionsPerHost}
                  onChange={(event) =>
                    onChange('maxConnectionsPerHost', numberValue(event.target.value))
                  }
                />
                <small>aria2 connections for each source host.</small>
              </label>

              <label htmlFor="host-bandwidth-cap">
                Bandwidth cap · MiB/s
                <input
                  id="host-bandwidth-cap"
                  type="number"
                  min={0}
                  max={1_048_576}
                  step={0.001}
                  value={bytesToMiB(draft.maxDownloadBytesPerSecond)}
                  onChange={(event) =>
                    onChange('maxDownloadBytesPerSecond', bytesFromMiB(event.target.value))
                  }
                />
                <small>0 means unlimited; stored as integer bytes/s.</small>
              </label>

              <label htmlFor="host-disk-reserve">
                Disk reserve · MiB
                <input
                  id="host-disk-reserve"
                  type="number"
                  min={0}
                  max={1_073_741_824}
                  step={0.001}
                  value={bytesToMiB(draft.minimumFreeDiskBytes)}
                  onChange={(event) =>
                    onChange('minimumFreeDiskBytes', bytesFromMiB(event.target.value))
                  }
                />
                <small>New jobs stop below this reserve; stored as integer bytes.</small>
              </label>

              <fieldset className="pp-host-settings-fieldset">
                <legend>Resume behavior</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.continuePartialDownloads}
                    onChange={(event) => onChange('continuePartialDownloads', event.target.checked)}
                  />
                  Continue partial downloads
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.alwaysResume}
                    onChange={(event) => onChange('alwaysResume', event.target.checked)}
                  />
                  Always resume when possible
                </label>
              </fieldset>

              <label htmlFor="host-file-allocation">
                File allocation
                <select
                  id="host-file-allocation"
                  value={draft.fileAllocation}
                  onChange={(event) => onChange('fileAllocation', event.target.value)}
                >
                  <option value="none">None</option>
                  <option value="prealloc">Preallocate</option>
                  <option value="trunc">Truncate</option>
                  <option value="falloc">falloc</option>
                </select>
                <small>Passed through to the external aria2c engine.</small>
              </label>

              <label htmlFor="host-overwrite-policy">
                Overwrite policy
                <select
                  id="host-overwrite-policy"
                  value={overwritePolicy}
                  onChange={(event) => {
                    const value = event.target.value;
                    onChange('autoRenameConflictingFiles', value === 'rename');
                    onChange('allowOverwriteExistingFiles', value === 'overwrite');
                  }}
                >
                  <option value="rename">Auto-rename conflicting files</option>
                  <option value="overwrite">Allow overwrite existing files</option>
                  <option value="refuse">Refuse conflicting files</option>
                </select>
                <small>Choose one explicit conflict policy.</small>
              </label>

              <label className="pp-host-settings-toggle" htmlFor="host-tls-verification">
                <span>
                  TLS verification
                  <small>Verify HTTPS certificates for transfer sources.</small>
                </span>
                <input
                  id="host-tls-verification"
                  type="checkbox"
                  checked={!draft.allowInsecureTls}
                  onChange={(event) => onChange('allowInsecureTls', !event.target.checked)}
                />
                <ShieldCheck aria-hidden="true" />
              </label>
            </div>

            <div className="pp-host-settings-actions">
              <button
                type="button"
                className="is-secondary"
                onClick={onReload}
                disabled={Boolean(busy)}
              >
                {busy === 'reload' ? (
                  <LoaderCircle className="is-spinning" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                Reload host settings
              </button>
              <button type="submit" disabled={Boolean(busy) || hostSaveBlocked}>
                {busy === 'save' ? (
                  <LoaderCircle className="is-spinning" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                Save host settings
              </button>
            </div>
            {hostSaveBlocked ? (
              <p className="pp-host-settings-note" aria-live="polite">
                {!snapshotConfirmed
                  ? 'Reload until the local snapshot confirms the Downloader state before saving host settings.'
                  : hostStatus === 'unavailable'
                    ? 'Reload until the local snapshot confirms the Downloader is stopped before saving host settings.'
                    : hostStatus === 'locked'
                      ? 'Another ProtoPeek process owns the Downloader; reload after it releases the engine.'
                      : 'Stop the Downloader before saving executable, filesystem, or process-policy changes.'}
              </p>
            ) : null}
          </form>
        ) : null}

        {!draft ? (
          <div className="pp-host-settings-actions">
            <button
              type="button"
              className="is-secondary"
              onClick={onReload}
              disabled={Boolean(busy)}
            >
              {busy === 'reload' ? (
                <LoaderCircle className="is-spinning" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              Reload host settings
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function canEditHostSettings(status: string) {
  return editableHostStatuses.has(status as TransferHealthStatus);
}

const bytesPerMiB = 1 << 20;

function bytesToMiB(bytes: number) {
  const value = bytes / bytesPerMiB;
  return Number.isInteger(value) ? value : Number(value.toFixed(3));
}

function bytesFromMiB(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  const bytes = Math.round(parsed * bytesPerMiB);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : Number.MAX_SAFE_INTEGER;
}

const hostPatchFields: Array<keyof TransferHostConfigPatch> = [
  'aria2Path',
  'downloadDirectory',
  'maxActiveJobs',
  'maxConnectionsPerHost',
  'maxDownloadBytesPerSecond',
  'minimumFreeDiskBytes',
  'continuePartialDownloads',
  'alwaysResume',
  'fileAllocation',
  'autoRenameConflictingFiles',
  'allowOverwriteExistingFiles',
  'allowInsecureTls',
];

function buildHostConfigPatch(
  before: TransferHostConfig,
  after: TransferHostConfig
): TransferHostConfigPatch {
  const patch: TransferHostConfigPatch = {};
  for (const field of hostPatchFields) {
    if (before[field] !== after[field]) {
      patch[field] = after[field] as never;
    }
  }
  return patch;
}

type GoBarryMigrationPanelProps = {
  preview: GoBarryMigrationPreview;
  busy: boolean;
  importPreferences: boolean;
  importSession: boolean;
  preservationAccepted: boolean;
  rollbackAccepted: boolean;
  onImportPreferences: (value: boolean) => void;
  onImportSession: (value: boolean) => void;
  onPreservationAccepted: (value: boolean) => void;
  onRollbackAccepted: (value: boolean) => void;
  onRefresh: () => void;
  onImport: () => void;
  onRollback: () => void;
};

function GoBarryMigrationPanel({
  preview,
  busy,
  importPreferences,
  importSession,
  preservationAccepted,
  rollbackAccepted,
  onImportPreferences,
  onImportSession,
  onPreservationAccepted,
  onRollbackAccepted,
  onRefresh,
  onImport,
  onRollback,
}: GoBarryMigrationPanelProps) {
  const nothingSelected = !importPreferences && !importSession;
  const targetStatus = migrationTargetStatus(preview);
  return (
    <div className="pp-migration-preview">
      <div className="pp-migration-status-grid">
        <MigrationStatus
          label="Preferences"
          value={
            preview.preferencesFound
              ? `${preview.settingChanges.length} compatible changes`
              : 'Not found'
          }
          ready={preview.preferencesFound}
        />
        <MigrationStatus
          label="Resumable session"
          value={
            preview.sessionFound
              ? `${preview.sessionEntries} ${preview.sessionEntries === 1 ? 'entry' : 'entries'} · ${formatMigrationBytes(preview.sessionBytes)}`
              : 'Not found'
          }
          ready={preview.sessionFound}
        />
        <MigrationStatus
          label="ProtoPeek target"
          value={targetStatus.value}
          ready={targetStatus.ready}
        />
      </div>

      {preview.settingChanges.length > 0 ? (
        <details className="pp-migration-details">
          <summary>Review compatible setting changes</summary>
          <dl>
            {preview.settingChanges.map((change) => (
              <div key={change.key}>
                <dt>{humanizeMigrationKey(change.key)}</dt>
                <dd>
                  <span>{change.before || 'Not set'}</span>
                  <b aria-hidden="true">→</b>
                  <strong>{change.after || 'Not set'}</strong>
                  {change.note ? <small>{change.note}</small> : null}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {preview.preservedButUnsupported.length > 0 || preview.warnings.length > 0 ? (
        <details className="pp-migration-details">
          <summary>Review preserved differences</summary>
          <ul>
            {[...preview.preservedButUnsupported, ...preview.warnings].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {preview.engineMustBeStopped ? (
        <p className="pp-settings-migration-warning" role="status">
          <TriangleAlert aria-hidden="true" /> Stop the Downloader and close GoBarryGo before the
          final preview/import. Preview remains read-only.
        </p>
      ) : null}

      {!preview.engineMustBeStopped ? (
        <p className="pp-settings-migration-note">
          Close GoBarryGo before refreshing this final preview or importing, so the copied source
          snapshot cannot change mid-operation.
        </p>
      ) : null}

      <fieldset className="pp-migration-selection" disabled={busy || preview.alreadyImported}>
        <legend>Choose what ProtoPeek should copy</legend>
        <label>
          <input
            type="checkbox"
            checked={importPreferences}
            disabled={!preview.preferencesFound}
            onChange={(event) => onImportPreferences(event.target.checked)}
          />
          <span>
            <strong>Compatible preferences</strong>
            <small>
              Limits, destination, connections, continuation, rename policy, and custom agent.
            </small>
          </span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={importSession}
            disabled={!preview.sessionFound}
            onChange={(event) => onImportSession(event.target.checked)}
          />
          <span>
            <strong>Resumable aria2 session</strong>
            <small>
              Deduplicated into ProtoPeek; command hooks and unsafe options are rejected.
            </small>
          </span>
        </label>
        <label className="pp-migration-preservation">
          <input
            type="checkbox"
            checked={preservationAccepted}
            onChange={(event) => onPreservationAccepted(event.target.checked)}
          />
          <span>
            <strong>Keep GoBarryGo untouched</strong>
            <small>
              I understand this is a copy. ProtoPeek will not delete, rename, uninstall, or rewrite
              the original files.
            </small>
          </span>
        </label>
      </fieldset>

      {preview.lastReceiptId ? (
        <label className="pp-migration-rollback-check">
          <input
            type="checkbox"
            checked={rollbackAccepted}
            disabled={busy}
            onChange={(event) => onRollbackAccepted(event.target.checked)}
          />
          <span>
            <strong>Allow guarded rollback</strong>
            <small>
              Restore receipt {preview.lastReceiptId}. ProtoPeek will refuse if its config or
              session changed after import, preserving the newer state instead.
            </small>
          </span>
        </label>
      ) : null}

      <div className="pp-migration-actions">
        <button type="button" className="is-secondary" onClick={onRefresh} disabled={busy}>
          Refresh preview
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={
            busy ||
            preview.alreadyImported ||
            !preview.canImport ||
            !preview.previewRevision ||
            !preservationAccepted ||
            nothingSelected
          }
        >
          {busy ? (
            <LoaderCircle className="is-spinning" aria-hidden="true" />
          ) : (
            <ArchiveRestore aria-hidden="true" />
          )}
          {preview.alreadyImported ? 'Already imported' : 'Import into ProtoPeek'}
        </button>
        {preview.lastReceiptId ? (
          <button
            type="button"
            className="is-danger"
            onClick={onRollback}
            disabled={busy || !rollbackAccepted}
          >
            <RotateCcw aria-hidden="true" /> Roll back this import
          </button>
        ) : null}
      </div>
    </div>
  );
}

function migrationTargetStatus(preview: GoBarryMigrationPreview) {
  if (preview.alreadyImported) {
    return { value: 'Exact state already imported', ready: true };
  }
  if (!preview.available) {
    return { value: 'No compatible GoBarryGo state available', ready: false };
  }
  if (preview.engineMustBeStopped) {
    return { value: 'Stop Downloader before import', ready: false };
  }
  if (!preview.canImport) {
    return { value: 'Import is not available for this state', ready: false };
  }
  return { value: 'Ready for explicit import', ready: true };
}

function MigrationStatus({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {ready ? <CheckCircle2 aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
        {value}
      </strong>
    </div>
  );
}

function humanizeMigrationKey(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

function formatMigrationBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
