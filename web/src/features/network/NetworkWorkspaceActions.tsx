import { Link } from '@tanstack/react-router';
import { Download, FileJson, Map as MapIcon, Network } from 'lucide-react';

import { networkGraphMLExportLosses } from '@/console/network-model';

export function ExportActions({
  onExport,
}: {
  onExport: (kind: 'json' | 'graphml' | 'csv') => void;
}) {
  return (
    <fieldset className="pp-network-export-actions">
      <legend className="sr-only">Export current network workspace</legend>
      <button type="button" title="Lossless canonical workspace" onClick={() => onExport('json')}>
        <FileJson aria-hidden="true" /> JSON
      </button>
      <button
        type="button"
        title={networkGraphMLExportLosses.join(' ')}
        onClick={() => onExport('graphml')}
      >
        <Network aria-hidden="true" /> GraphML
      </button>
      <button type="button" title="Current inventory only" onClick={() => onExport('csv')}>
        <Download aria-hidden="true" /> CSV
      </button>
    </fieldset>
  );
}

export function NetworkEmptyState() {
  return (
    <div className="pp-network-empty">
      <MapIcon aria-hidden="true" />
      <h2>No saved network evidence</h2>
      <p>Trace a path, scan an authorized private CIDR, or import a bounded JSON/GraphML file.</p>
      <div>
        <Link className="pp-network-empty-action" to="/network/path">
          Trace a path
        </Link>
        <Link className="pp-network-empty-action" to="/network/local">
          Scan local network
        </Link>
      </div>
    </div>
  );
}
