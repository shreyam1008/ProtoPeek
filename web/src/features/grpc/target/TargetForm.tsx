import { Play, X } from 'lucide-react';
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
  return (
    <div className="space-y-3">
      <fieldset disabled={busy} className="min-w-0 space-y-3 border-0 p-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="pp-label">Address</span>
            <input
              className="pp-input mt-1"
              value={draft.address}
              onChange={(event) => onChange({ address: event.target.value })}
              placeholder="localhost:50051"
            />
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
          <div className="pp-transport-choice">
            <span className="pp-label">Transport</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.plaintext}
                onChange={(event) =>
                  onChange({
                    plaintext: event.target.checked,
                    insecure: event.target.checked ? false : draft.insecure,
                  })
                }
              />
              {draft.plaintext ? 'Plaintext' : 'TLS'}
            </label>
          </div>
        </div>
        {draft.schemaSource === 'browser-proto-folder' ? (
          <BrowserProtoFolderPicker
            selection={browserProtoFolder}
            onChange={onBrowserProtoFolderChange}
            onBusyChange={onBrowserProtoFolderBusyChange}
            disabled={busy}
          />
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
            {draft.schemaSource === 'proto-files' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="pp-label">Proto files</span>
                  <textarea
                    className="pp-input mt-1 font-mono text-xs"
                    rows={3}
                    value={draft.protoFiles.join('\n')}
                    onChange={(event) =>
                      onChange({ protoFiles: parseMultilineValues(event.target.value) })
                    }
                    placeholder="api/service.proto"
                  />
                </label>
                <label className="block">
                  <span className="pp-label">Import paths</span>
                  <textarea
                    className="pp-input mt-1 font-mono text-xs"
                    rows={3}
                    value={draft.importPaths.join('\n')}
                    onChange={(event) =>
                      onChange({ importPaths: parseMultilineValues(event.target.value) })
                    }
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
                  value={draft.protosets.join('\n')}
                  onChange={(event) =>
                    onChange({ protosets: parseMultilineValues(event.target.value) })
                  }
                  placeholder="dist/service.protoset"
                />
              </label>
            ) : null}
          </div>
        </details>
      </fieldset>
      <div className="flex gap-2">
        <button
          className={busy ? 'pp-button-secondary' : 'pp-button-primary'}
          type="button"
          disabled={
            !busy &&
            (browserProtoFolderBusy ||
              (draft.schemaSource === 'browser-proto-folder' && !browserProtoFolder))
          }
          aria-describedby={
            !busy && draft.schemaSource === 'browser-proto-folder' && !browserProtoFolder
              ? 'pp-browser-proto-folder-required'
              : undefined
          }
          onClick={busy ? onCancelConnect : onSaveAndConnect}
        >
          {busy ? <X className="size-3.5" /> : <Play className="size-3.5" />}
          {busy ? 'Cancel connection' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
