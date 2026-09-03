import { Plus, Save } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

import {
  type NetworkGroup,
  type NetworkWorkspaceV1,
  networkWorkspaceLimits,
} from '@/console/network-model';
import type { NetworkStoreMetadata } from '@/console/network-store';
import { ExportActions, NetworkEmptyState } from '../NetworkWorkspaceActions';

export const loadTopologyCanvas = () => import('@/console/TopologyCanvas');
const LazyTopologyCanvas = lazy(async () => {
  const module = await loadTopologyCanvas();
  return { default: module.TopologyCanvas };
});

export function NetworkMapPage({
  loading,
  workspace,
  workspaces,
  dirty,
  onSelect,
  onChange,
  onSave,
  onExport,
}: {
  loading: boolean;
  workspace: NetworkWorkspaceV1 | null;
  workspaces: readonly NetworkStoreMetadata[];
  dirty: boolean;
  onSelect: (id: string) => void;
  onChange: (workspace: NetworkWorkspaceV1) => void;
  onSave: () => void;
  onExport: (kind: 'json' | 'graphml' | 'csv') => void;
}) {
  return (
    <section className="pp-network-map-page" aria-labelledby="network-map-title">
      <header className="pp-network-page-heading">
        <div>
          <span className="pp-kicker">Infinite drafting surface + accessible inventory</span>
          <h1 id="network-map-title">Network evidence map</h1>
          <p>
            Arrange logical evidence by subnet, site, VLAN, region, or your own groups. Lines show
            observed or manual relationships, not physical cabling.
          </p>
        </div>
        <WorkspacePicker
          workspaces={workspaces}
          workspace={workspace}
          dirty={dirty}
          onSelect={onSelect}
        />
      </header>

      {loading ? <p className="pp-network-loading">Loading saved workspaces…</p> : null}
      {!loading && !workspace ? <NetworkEmptyState /> : null}
      {workspace ? (
        <>
          <section className="pp-workspace-editor" aria-label="Workspace details and export">
            <label>
              <span>Workspace name</span>
              <input
                value={workspace.name}
                maxLength={512}
                onChange={(event) =>
                  onChange({
                    ...workspace,
                    name: event.target.value,
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
            </label>
            <label>
              <span>Tags</span>
              <input
                value={workspace.tags.join(', ')}
                placeholder="production, mumbai, vlan-20"
                onChange={(event) =>
                  onChange({
                    ...workspace,
                    tags: uniqueTags(event.target.value),
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
            </label>
            <button type="button" className="is-primary" disabled={!dirty} onClick={onSave}>
              <Save aria-hidden="true" /> {dirty ? 'Save edits' : 'Saved'}
            </button>
            <ExportActions onExport={onExport} />
          </section>
          <GroupEditor workspace={workspace} onChange={onChange} />
          <Suspense fallback={<p className="pp-network-loading">Loading interactive map…</p>}>
            <LazyTopologyCanvas workspace={workspace} onChange={onChange} />
          </Suspense>
        </>
      ) : null}
    </section>
  );
}

function WorkspacePicker({
  workspaces,
  workspace,
  dirty,
  onSelect,
}: {
  workspaces: readonly NetworkStoreMetadata[];
  workspace: NetworkWorkspaceV1 | null;
  dirty: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <label className="pp-workspace-picker">
      <span>Current workspace</span>
      <select
        value={workspace?.id ?? ''}
        disabled={dirty}
        title={dirty ? 'Save or discard edits before switching workspaces.' : undefined}
        onChange={(event) => onSelect(event.target.value)}
      >
        {workspaces.length === 0 ? <option value="">No saved workspace</option> : null}
        {workspaces.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name || candidate.id} · {candidate.nodeCount} nodes
          </option>
        ))}
      </select>
    </label>
  );
}

function GroupEditor({
  workspace,
  onChange,
}: {
  workspace: NetworkWorkspaceV1;
  onChange: (workspace: NetworkWorkspaceV1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NetworkGroup['kind']>('subnet');
  const [name, setName] = useState('');
  const [detail, setDetail] = useState('');
  const detailError = manualGroupDetailError(kind, detail);
  const showDetailError = Boolean(detailError && (name.trim() || detail.trim()));

  function addGroup() {
    const normalizedName = name.trim();
    if (!normalizedName || detailError) return;
    const now = new Date().toISOString();
    const sequence = workspace.groups.length + 1;
    const group: NetworkGroup = {
      id: `group-${Date.now()}-${sequence}`,
      kind,
      name: normalizedName,
      tags: [],
      notes: '',
      regionCode: kind === 'region' ? detail.trim().toUpperCase() : '',
      siteCode: kind === 'site' ? detail.trim() : '',
      vlanId: kind === 'vlan' ? Number(detail) : null,
      cidr: kind === 'subnet' ? detail.trim() : '',
      position: { x: sequence * 70, y: sequence * 50, pinned: false },
      provenance: [
        {
          kind: 'manual',
          source: 'manual',
          observedAt: now,
          detail: 'User-created organizational group; not discovered network evidence.',
        },
      ],
    };
    onChange({
      ...workspace,
      updatedAt: now,
      groups: [...workspace.groups, group],
      snapshots: workspace.snapshots,
    });
    setName('');
    setDetail('');
    setOpen(false);
  }

  return (
    <details
      className="pp-group-editor"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Plus aria-hidden="true" /> Add an organizational group
        <small>{workspace.groups.length} groups · manual evidence</small>
      </summary>
      <div>
        <label>
          Type
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as NetworkGroup['kind']);
              setDetail('');
            }}
          >
            <option value="subnet">Subnet</option>
            <option value="vlan">VLAN</option>
            <option value="site">Site</option>
            <option value="region">Region</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Name
          <input
            value={name}
            maxLength={networkWorkspaceLimits.maxLabelBytes}
            onChange={(event) => setName(event.target.value)}
            placeholder="Payments subnet"
          />
        </label>
        <label>
          {kind === 'subnet'
            ? 'CIDR'
            : kind === 'vlan'
              ? 'VLAN ID'
              : kind === 'region'
                ? 'Region code'
                : kind === 'site'
                  ? 'Site code'
                  : 'Optional code'}
          <input
            type={kind === 'vlan' ? 'number' : 'text'}
            min={kind === 'vlan' ? 1 : undefined}
            max={kind === 'vlan' ? 4094 : undefined}
            maxLength={kind === 'vlan' ? undefined : networkWorkspaceLimits.maxValueBytes}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder={kind === 'subnet' ? '10.20.0.0/24' : kind === 'vlan' ? '20' : 'BOM'}
          />
        </label>
        {showDetailError ? (
          <p className="pp-group-error" role="alert">
            {detailError}
          </p>
        ) : null}
        <button type="button" disabled={!name.trim() || Boolean(detailError)} onClick={addGroup}>
          Add group
        </button>
      </div>
    </details>
  );
}

function uniqueTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ).slice(0, networkWorkspaceLimits.maxTags);
}

function manualGroupDetailError(kind: NetworkGroup['kind'], value: string) {
  const detail = value.trim();
  if (kind === 'custom') return '';
  const label = {
    subnet: 'CIDR',
    vlan: 'VLAN ID',
    site: 'Site code',
    region: 'Region code',
    custom: 'Code',
  }[kind];
  if (!detail) return `${label} is required.`;
  if (kind === 'subnet' && !validManualCIDR(detail)) {
    return 'CIDR must be an explicit IPv4 or IPv6 prefix, such as 10.20.0.0/24.';
  }
  if (kind === 'vlan') {
    const vlanID = Number(detail);
    if (!Number.isInteger(vlanID) || vlanID < 1 || vlanID > 4094) {
      return 'VLAN ID must be a whole number from 1 through 4094.';
    }
  }
  return '';
}

function validManualCIDR(value: string) {
  const separator = value.lastIndexOf('/');
  if (separator <= 0 || separator === value.length - 1) return false;
  const address = value.slice(0, separator);
  const prefixText = value.slice(separator + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  if (address.includes(':')) {
    if (prefix < 0 || prefix > 128 || address.includes('%')) return false;
    try {
      return new URL(`http://[${address}]/`).hostname.startsWith('[');
    } catch {
      return false;
    }
  }
  if (prefix < 0 || prefix > 32) return false;
  const octets = address.split('.');
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => /^\d{1,3}$/.test(octet) && String(Number(octet)) === octet && Number(octet) <= 255
    )
  );
}
