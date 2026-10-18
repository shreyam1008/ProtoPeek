import { Play, X } from 'lucide-react';

import { useEffect, useId, useState } from 'react';

import { BrowserProtoFolderPicker } from '@/console/BrowserProtoFolderPicker';
import { parseMultilineValues } from '@/features/grpc/workspace/model';
import type { BrowserProtoFolderSelection } from '@/shared/proto-folder';
import type { WorkspaceTargetProfile } from '@/shared/types';

export function TargetForm({
  draft,
  browserProtoFolder,
  browserProtoFolderBusy,
  busy,
  onChange,
  onBrowserProtoFolderChange,
  onBrowserProtoFolderBusyChange,
  onSaveAndConnect,
  onCancelConnect,
}: {
  draft: WorkspaceTargetProfile;
  browserProtoFolder: BrowserProtoFolderSelection | null;
  browserProtoFolderBusy: boolean;
  busy: boolean;
  onChange: (next: Partial<WorkspaceTargetProfile>) => void;
  onBrowserProtoFolderChange: (selection: BrowserProtoFolderSelection | null) => void;
  onBrowserProtoFolderBusyChange: (busy: boolean) => void;
  onSaveAndConnect: () => void;
  onCancelConnect: () => void;
}) {
  const formID = useId();

  const [submitted, setSubmitted] = useState(false);

  const [pathText, setPathText] = useState({
    protoFiles: draft.protoFiles.join('\n'),

    importPaths: draft.importPaths.join('\n'),

    protosets: draft.protosets.join('\n'),
  });

  useEffect(() => {
    setPathText((current) => {
      const next = { ...current };

      let changed = false;

      for (const key of ['protoFiles', 'importPaths', 'protosets'] as const) {
        if (JSON.stringify(parseMultilineValues(current[key])) === JSON.stringify(draft[key]))
          continue;

        next[key] = draft[key].join('\n');

        changed = true;
      }

      return changed ? next : current;
    });
  }, [draft]);

  function changePaths(key: 'protoFiles' | 'importPaths' | 'protosets', value: string) {
    setPathText((current) => ({ ...current, [key]: value }));

    onChange({ [key]: parseMultilineValues(value) });
  }

  const missingAddress = !draft.address.trim();
  const missingProto =
    draft.schemaSource === 'proto-files' && !draft.protoFiles.some((path) => path.trim());
  const missingProtoset =
    draft.schemaSource === 'protoset' && !draft.protosets.some((path) => path.trim());
  const addressError = submitted && missingAddress;
  const protoError = submitted && missingProto;
  const protosetError = submitted && missingProtoset;

  return (
    <form
      className="space-y-3"
      aria-label="gRPC target connection"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();

        if (busy || browserProtoFolderBusy) return;

        setSubmitted(true);

        if (
          missingAddress ||
          missingProto ||
          missingProtoset ||
          (draft.schemaSource === 'browser-proto-folder' && !browserProtoFolder)
        ) {
          const form = event.currentTarget;

          requestAnimationFrame(() =>
            form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
          );

          return;
        }

        onSaveAndConnect();
      }}
    >
      <fieldset disabled={busy} className="min-w-0 space-y-3 border-0 p-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="pp-label">Address</span>
            <input
              className="pp-input mt-1"
              value={draft.address}
              aria-label="Address"
              required
              aria-invalid={addressError}
              aria-describedby={addressError ? `${formID}-address-error` : undefined}
              onChange={(event) => onChange({ address: event.target.value })}
              placeholder="localhost:50051"
            />
            {addressError ? (
              <span id={`${formID}-address-error`} className="pp-target-field-error" role="alert">
                Enter the service address.
              </span>
            ) : null}
          </label>
          <label className="block">
            <span className="pp-label">
              Name <small>optional</small>
            </span>
            <input
              className="pp-input mt-1"
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder="Local dev"
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="pp-label">Schema source</span>
            <select
              className="pp-input mt-1"
              value={draft.schemaSource}
              onChange={(event) =>
                onChange({
                  schemaSource: event.target.value as WorkspaceTargetProfile['schemaSource'],
                })
              }
            >
              <option value="reflection">Reflection</option>
              <option value="browser-proto-folder">Browser folder</option>
              <option value="proto-files">Host proto paths</option>
              <option value="protoset">Host protoset paths</option>
            </select>
          </label>
          <label className="block">
            <span className="pp-label">Transport</span>
            <select
              className="pp-input mt-1"
              aria-label="gRPC transport"
              value={draft.plaintext ? 'plaintext' : 'tls'}
              onChange={(event) =>
                onChange({
                  plaintext: event.target.value === 'plaintext',
                  insecure: event.target.value === 'plaintext' ? false : draft.insecure,
                })
              }
            >
              <option value="tls">TLS (encrypted)</option>
              <option value="plaintext">Plaintext (local development)</option>
            </select>
          </label>
        </div>
        {draft.schemaSource === 'browser-proto-folder' ? (
          <BrowserProtoFolderPicker
            selection={browserProtoFolder}
            onChange={onBrowserProtoFolderChange}
            onBusyChange={onBrowserProtoFolderBusyChange}
            disabled={busy}
          />
        ) : null}
        {draft.schemaSource === 'proto-files' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="pp-label">Proto files</span>
              <textarea
                className="pp-input mt-1 font-mono text-xs"
                rows={3}
                required
                aria-label="Proto files"
                aria-invalid={protoError}
                aria-describedby={`${formID}-proto-help${protoError ? ` ${formID}-proto-error` : ''}`}
                value={pathText.protoFiles}
                onChange={(event) => changePaths('protoFiles', event.target.value)}
                placeholder="api/service.proto"
              />
              <span id={`${formID}-proto-help`} className="pp-target-field-hint">
                One file path per line, on the device running ProtoPeek.
              </span>
              {protoError ? (
                <span id={`${formID}-proto-error`} className="pp-target-field-error" role="alert">
                  Add at least one proto file path.
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="pp-label">Import paths</span>
              <textarea
                className="pp-input mt-1 font-mono text-xs"
                rows={3}
                value={pathText.importPaths}
                onChange={(event) => changePaths('importPaths', event.target.value)}
                placeholder="proto"
              />
            </label>
          </div>
        ) : null}
        {draft.schemaSource === 'protoset' ? (
          <label className="block">
            <span className="pp-label">Protoset files</span>
            <textarea
              className="pp-input mt-1 font-mono text-xs"
              rows={3}
              required
              aria-label="Protoset files"
              aria-invalid={protosetError}
              aria-describedby={`${formID}-protoset-help${protosetError ? ` ${formID}-protoset-error` : ''}`}
              value={pathText.protosets}
              onChange={(event) => changePaths('protosets', event.target.value)}
              placeholder="dist/service.protoset"
            />
            <span id={`${formID}-protoset-help`} className="pp-target-field-hint">
              One file path per line, on the device running ProtoPeek.
            </span>
            {protosetError ? (
              <span id={`${formID}-protoset-error`} className="pp-target-field-error" role="alert">
                Add at least one protoset file path.
              </span>
            ) : null}
          </label>
        ) : null}
        <details className="pp-target-advanced">
          <summary>Advanced connection options</summary>
          <div className="pp-target-advanced-body">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="pp-label">Authority</span>
                <input
                  className="pp-input mt-1"
                  value={draft.authority}
                  onChange={(event) => onChange({ authority: event.target.value })}
                  placeholder="grpc.example.internal"
                />
              </label>
              <label className="block">
                <span className="pp-label">Notes</span>
                <input
                  className="pp-input mt-1"
                  value={draft.notes}
                  onChange={(event) => onChange({ notes: event.target.value })}
                  placeholder="Optional context"
                />
              </label>
            </div>
            {!draft.plaintext ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.insecure}
                  onChange={(event) => onChange({ insecure: event.target.checked })}
                />
                Skip certificate verification
              </label>
            ) : null}
            {!draft.plaintext ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="pp-label">CA cert</span>
                  <input
                    className="pp-input mt-1"
                    value={draft.cacertPath}
                    onChange={(event) => onChange({ cacertPath: event.target.value })}
                    placeholder="/certs/ca.pem"
                  />
                </label>
                <label className="block">
                  <span className="pp-label">Client cert</span>
                  <input
                    className="pp-input mt-1"
                    value={draft.certPath}
                    onChange={(event) => onChange({ certPath: event.target.value })}
                    placeholder="/certs/client.pem"
                  />
                </label>
                <label className="block">
                  <span className="pp-label">Client key</span>
                  <input
                    className="pp-input mt-1"
                    value={draft.keyPath}
                    onChange={(event) => onChange({ keyPath: event.target.value })}
                    placeholder="/certs/key.pem"
                  />
                </label>
              </div>
            ) : null}
          </div>
        </details>
      </fieldset>
      <div className="flex gap-2">
        {busy ? (
          <button type="button" className="pp-button-secondary" onClick={onCancelConnect}>
            <X className="size-3.5" aria-hidden="true" /> Cancel connection
          </button>
        ) : (
          <button
            className="pp-button-primary"
            type="submit"
            disabled={
              browserProtoFolderBusy ||
              (draft.schemaSource === 'browser-proto-folder' && !browserProtoFolder)
            }
            aria-describedby={
              draft.schemaSource === 'browser-proto-folder' && !browserProtoFolder
                ? 'pp-browser-proto-folder-required'
                : undefined
            }
          >
            <Play className="size-3.5" aria-hidden="true" /> Connect
          </button>
        )}
      </div>
    </form>
  );
}
