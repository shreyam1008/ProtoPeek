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
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';

import type { ProtoPeekTheme } from '@/shared/theme';

import { defaultInterfacePreferences, type InterfaceDensity } from './interface-preferences';
import { useProtocolShell } from './ProtocolShellContext';
import {
  type GoBarryMigrationPreview,
  importGoBarryState,
  previewGoBarryMigration,
  rollbackGoBarryState,
} from './transfer-api';
import './suite-pages.css';
import './settings.css';

const themes: Array<{ value: ProtoPeekTheme; label: string; detail: string }> = [
  { value: 'light', label: 'Light', detail: 'Bright evidence surfaces and dark text.' },
  { value: 'dark', label: 'Dark', detail: 'Low-glare console surfaces and teal signals.' },
];

const densities: Array<{ value: InterfaceDensity; label: string; detail: string }> = [
  { value: 'comfortable', label: 'Comfortable', detail: 'More breathing room in app chrome.' },
  { value: 'compact', label: 'Compact', detail: 'Tighter navigation and header controls.' },
];

export function Settings() {
  const { theme, setTheme, interfacePreferences, setInterfacePreferences } = useProtocolShell();
  const [notice, setNotice] = useState('');
  const [migrationPreview, setMigrationPreview] = useState<GoBarryMigrationPreview | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState('');
  const [importPreferences, setImportPreferences] = useState(true);
  const [importSession, setImportSession] = useState(true);
  const [preservationAccepted, setPreservationAccepted] = useState(false);
  const [rollbackAccepted, setRollbackAccepted] = useState(false);

  function setDensity(density: InterfaceDensity) {
    setNotice('');
    setInterfacePreferences({ ...interfacePreferences, density });
  }

  function setKeyboardHints(showKeyboardHints: boolean) {
    setNotice('');
    setInterfacePreferences({ ...interfacePreferences, showKeyboardHints });
  }

  function restoreDefaults() {
    setTheme('light');
    setInterfacePreferences(defaultInterfacePreferences);
    setNotice('Interface defaults restored.');
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
      const result = await importGoBarryState({ importPreferences, importSession });
      setNotice(result.message || 'GoBarryGo state imported into ProtoPeek.');
      const refreshed = await previewGoBarryMigration();
      setMigrationPreview(refreshed);
      setPreservationAccepted(false);
      setRollbackAccepted(false);
    } catch (cause) {
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
      setNotice(result.message || 'ProtoPeek transfer state restored from the migration receipt.');
      const refreshed = await previewGoBarryMigration();
      setMigrationPreview(refreshed);
      setRollbackAccepted(false);
    } catch (cause) {
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
            Interface preferences stay browser-local. Any host-state action below is separated,
            preview-first, and requires your explicit confirmation.
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
            <legend>Theme</legend>
            {themes.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={theme === option.value}
                onClick={() => {
                  setNotice('');
                  setTheme(option.value);
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
                CPU, memory, scan authorization, TLS verification, and protocol deadlines remain
                explicit where they are used. Only the reviewed migration card below can copy its
                allowlisted transfer preferences into host state.
              </p>
            </div>
          </div>

          <button type="button" className="pp-settings-reset" onClick={restoreDefaults}>
            <RotateCcw aria-hidden="true" /> Restore interface defaults
          </button>
        </section>

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
