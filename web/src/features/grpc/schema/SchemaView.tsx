import { Copy, Download, Search } from 'lucide-react';
import { GrpcMetric } from '@/features/grpc/GrpcViewPrimitives';
import type {
  ProtoCatalogResponse,
  ProtoEnumSummary,
  ProtoFileSummary,
  ProtoMessageSummary,
} from '@/shared/types';
import { classNames } from '@/shared/utils';

function countMessages(messages: ProtoMessageSummary[]): number {
  return messages.reduce((total, message) => total + 1 + countMessages(message.messages), 0);
}

function countEnums(messages: ProtoMessageSummary[], enums: ProtoEnumSummary[]): number {
  return (
    enums.length +
    messages.reduce((total, message) => total + countEnums(message.messages, message.enums), 0)
  );
}

export function SchemaView({
  catalog,
  searchText,
  onSearchChange,
  selectedFile,
  onSelectFile,
  selectedProto,
  showWellKnown,
  onToggleWellKnown,
  visibleFiles,
  onExportCatalog,
  onExportProto,
}: {
  catalog: ProtoCatalogResponse | null;
  searchText: string;
  onSearchChange: (value: string) => void;
  selectedFile: string;
  onSelectFile: (value: string) => void;
  selectedProto: ProtoFileSummary | null;
  showWellKnown: boolean;
  onToggleWellKnown: (value: boolean) => void;
  visibleFiles: ProtoFileSummary[];
  onExportCatalog: () => void;
  onExportProto: (file: ProtoFileSummary) => void;
}) {
  if (!catalog) return <div className="text-sm text-pp-muted">Loading proto catalog...</div>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <GrpcMetric label="Files" value={String(catalog.files.length)} />
        <GrpcMetric
          label="Services"
          value={String(catalog.files.reduce((total, file) => total + file.services.length, 0))}
        />
        <GrpcMetric
          label="Messages"
          value={String(
            catalog.files.reduce((total, file) => total + countMessages(file.messages), 0)
          )}
        />
        <GrpcMetric
          label="Enums"
          value={String(
            catalog.files.reduce((total, file) => total + countEnums(file.messages, file.enums), 0)
          )}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-pp-muted" />
          <input
            className="pp-input pl-8 text-xs"
            value={searchText}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search protos..."
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showWellKnown}
            onChange={(event) => onToggleWellKnown(event.target.checked)}
          />
          Well-known
        </label>
        <button className="pp-button-secondary text-xs" type="button" onClick={onExportCatalog}>
          <Download className="size-3" />
          Export JSON
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="space-y-1 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {visibleFiles.map((file) => (
            <button
              key={file.name}
              type="button"
              onClick={() => onSelectFile(file.name)}
              className={classNames(
                'block w-full rounded-md border p-2 text-left text-xs transition',
                file.name === selectedFile
                  ? 'border-pp-brand bg-pp-brand/5 font-semibold'
                  : 'border-pp-border hover:bg-pp-bg'
              )}
            >
              <div className="truncate text-pp-ink">{file.name}</div>
              <div className="text-pp-muted">
                {file.package || 'no pkg'} · {file.services.length}s ·{' '}
                {countMessages(file.messages)}m
              </div>
            </button>
          ))}
        </div>
        {selectedProto ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="pp-heading text-base">{selectedProto.name}</h4>
                <div className="text-xs text-pp-muted">
                  pkg {selectedProto.package || 'none'} · {selectedProto.dependencies.length} deps
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="pp-button-secondary text-xs"
                  type="button"
                  onClick={() => onExportProto(selectedProto)}
                >
                  <Download className="size-3" />
                  .proto
                </button>
                <button
                  className="pp-button-ghost text-xs"
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(selectedProto.protoText)}
                >
                  <Copy className="size-3" />
                  Copy
                </button>
              </div>
            </div>
            {selectedProto.services.map((service) => (
              <div key={service.fullName} className="pp-panel">
                <div className="text-sm font-semibold text-pp-ink">{service.fullName}</div>
                <div className="mt-2 space-y-1">
                  {service.methods.map((method) => (
                    <div
                      key={method.fullName}
                      className="flex items-center justify-between rounded border border-pp-border bg-pp-bg px-2 py-1 text-xs"
                    >
                      <span className="font-medium">{method.name}</span>
                      <span className="font-mono text-pp-muted">
                        {method.requestType} → {method.responseType}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {selectedProto.messages.map((message) => (
              <ProtoMessage key={message.fullName} message={message} />
            ))}
            {selectedProto.enums.map((entry) => (
              <ProtoEnum key={entry.fullName} entry={entry} />
            ))}
            <div>
              <span className="pp-label">Raw proto</span>
              <pre className="pp-code mt-1 max-h-80 overflow-auto text-xs">
                {selectedProto.protoText}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-sm text-pp-muted">Select a file to inspect.</div>
        )}
      </div>
    </div>
  );
}

function ProtoMessage({ message }: { message: ProtoMessageSummary }) {
  return (
    <div className="rounded-lg border border-pp-border bg-white p-3">
      <div className="text-sm font-semibold text-pp-ink">{message.fullName}</div>
      <div className="mt-2 space-y-1">
        {message.fields.map((field) => (
          <div
            key={`${message.fullName}-${field.name}`}
            className="flex flex-wrap items-center gap-1 rounded border border-pp-border bg-pp-bg px-2 py-1 text-xs"
          >
            <span className="font-semibold text-pp-ink">{field.name}</span>
            <span className="pp-badge">{field.type}</span>
            <span className="pp-badge">{field.label}</span>
            {field.oneOf ? <span className="pp-badge">oneof {field.oneOf}</span> : null}
            {field.map ? <span className="pp-badge">map</span> : null}
          </div>
        ))}
      </div>
      {message.enums.length > 0 ? (
        <div className="mt-2 space-y-1">
          {message.enums.map((entry) => (
            <ProtoEnum key={entry.fullName} entry={entry} />
          ))}
        </div>
      ) : null}
      {message.messages.length > 0 ? (
        <div className="mt-2 space-y-1">
          {message.messages.map((nestedMessage) => (
            <ProtoMessage key={nestedMessage.fullName} message={nestedMessage} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProtoEnum({ entry }: { entry: ProtoEnumSummary }) {
  return (
    <div className="rounded-lg border border-pp-border bg-white p-3">
      <div className="text-xs font-semibold text-pp-ink">{entry.fullName}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {entry.values.map((value) => (
          <span key={`${entry.fullName}-${value.name}`} className="pp-badge">
            {value.name}={value.number}
          </span>
        ))}
      </div>
    </div>
  );
}
