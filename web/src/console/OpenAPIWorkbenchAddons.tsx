import { FileJson2, PanelLeftClose, Search, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { OpenAPICollection, OpenAPIOperation } from './openapi';
import './openapi-workbench.css';

export function OpenAPIImportPanel({
  url,
  error,
  importing,
  onURLChange,
  onImportURL,
  onImportFile,
  onClose,
}: {
  url: string;
  error: string | null;
  importing: boolean;
  onURLChange: (url: string) => void;
  onImportURL: () => void;
  onImportFile: (file?: File) => void;
  onClose: () => void;
}) {
  return (
    <section
      className="pp-openapi-import-panel"
      role="dialog"
      aria-labelledby="openapi-import-title"
    >
      <header>
        <div>
          <FileJson2 className="pp-openapi-heading-icon" aria-hidden="true" />
          <span>
            <strong id="openapi-import-title">Import API definition</strong>
            <small>OpenAPI 3.x or Swagger 2.0 JSON</small>
          </span>
        </div>
        <button type="button" aria-label="Close API definition import" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onImportURL();
        }}
      >
        <label htmlFor="openapi-definition-url">Swagger, Scalar, or definition URL</label>
        <div>
          <input
            id="openapi-definition-url"
            className="pp-openapi-url-input"
            value={url}
            onChange={(event) => onURLChange(event.target.value)}
            placeholder="http://localhost:8080/openapi.json"
            spellCheck={false}
          />
          <button type="submit" className="pp-openapi-import-submit" disabled={importing}>
            {importing ? 'Importing…' : 'Import URL'}
          </button>
        </div>
      </form>
      <div className="pp-openapi-import-divider">
        <span>or</span>
      </div>
      <label className="pp-openapi-file-action">
        <Upload className="pp-openapi-file-icon" aria-hidden="true" /> Choose JSON file
        <input
          type="file"
          className="pp-openapi-file-input"
          accept="application/json,.json"
          onChange={(event) => {
            onImportFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </label>
      <p>
        Docs-page URLs are followed only when they expose a linked JSON definition. Requests use
        ProtoPeek&apos;s bounded local HTTP relay.
      </p>
      {error ? <div role="alert">{error}</div> : null}
    </section>
  );
}

export function OpenAPIOperationRail({
  collection,
  selectedOperation,
  onSelect,
  onClose,
}: {
  collection: OpenAPICollection;
  selectedOperation: string | null;
  onSelect: (operation: OpenAPIOperation) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const grouped = new Map<string, OpenAPIOperation[]>();
    for (const operation of collection.operations) {
      if (
        query &&
        !`${operation.method} ${operation.path} ${operation.summary} ${operation.tag}`
          .toLowerCase()
          .includes(query)
      ) {
        continue;
      }
      const entries = grouped.get(operation.tag) ?? [];
      entries.push(operation);
      grouped.set(operation.tag, entries);
    }
    return [...grouped.entries()];
  }, [collection.operations, filter]);

  return (
    <aside className="pp-openapi-rail" aria-label={`${collection.title} operations`}>
      <header>
        <span>
          <small>OPENAPI · {collection.version}</small>
          <strong>{collection.title}</strong>
          <code className="pp-openapi-source" title={collection.source}>
            {collection.source}
          </code>
        </span>
        <button type="button" aria-label="Hide API operation list" onClick={onClose}>
          <PanelLeftClose aria-hidden="true" />
        </button>
      </header>
      <label className="pp-openapi-search">
        <Search className="pp-openapi-search-icon" aria-hidden="true" />
        <span className="sr-only">Filter imported API operations</span>
        <input
          value={filter}
          className="pp-openapi-search-input"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter operations"
        />
      </label>
      <div className="pp-openapi-operation-list">
        {groups.map(([tag, operations]) => (
          <section key={tag}>
            <h2>
              {tag}
              <span>{operations.length}</span>
            </h2>
            {operations.map((operation) => (
              <button
                key={operation.id}
                type="button"
                className={selectedOperation === operation.id ? 'is-active' : undefined}
                aria-pressed={selectedOperation === operation.id}
                onClick={() => onSelect(operation)}
              >
                <span className={`is-${operation.method.toLowerCase()}`}>{operation.method}</span>
                <strong>{operation.summary}</strong>
                <code className="pp-openapi-operation-path">{operation.path}</code>
              </button>
            ))}
          </section>
        ))}
        {!groups.length ? <p>No operations match “{filter}”.</p> : null}
      </div>
    </aside>
  );
}
