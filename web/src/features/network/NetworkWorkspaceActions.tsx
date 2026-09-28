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
      <p>
        Save a nearby-device scan or a measured route to explore it here. You can also import a
        saved map.
      </p>
      <div>
        <Link className="pp-network-empty-action" to="/network/local">
          See nearby devices
        </Link>
        <Link className="pp-network-empty-action" to="/network/path">
          Trace a path
        </Link>
      </div>
    </div>
  );
}
