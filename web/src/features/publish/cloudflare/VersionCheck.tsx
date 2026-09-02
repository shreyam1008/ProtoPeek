import { Copy, Download, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import type { TunnelCapabilities, TunnelRelease } from '@/console/tunnels-api';
import { copyText, formatTimestamp } from './view-helpers';

export function VersionCheck({
  release,
  loading,
  error,
  installedVersion,
  onCheck,
}: {
  release: TunnelRelease | null;
  loading: boolean;
  error: string;
  installedVersion: string;
  onCheck: () => void;
}) {
  return (
    <section className="pp-tunnel-release" aria-labelledby="tunnel-release-heading">
      <header>
        <div>
          <span className="pp-tunnel-section-label">Release freshness</span>
          <h3 id="tunnel-release-heading">cloudflared version</h3>
          <p>Contacts GitHub Releases only when you click the check button.</p>
        </div>
        <button type="button" disabled={loading} onClick={onCheck}>
          <RefreshCw aria-hidden="true" className={loading ? 'is-spinning' : ''} />
          {loading ? 'Checking…' : 'Check latest version'}
        </button>
      </header>
      <dl>
        <div>
          <dt>Installed</dt>
          <dd>{release?.installedVersion || installedVersion || 'Not installed'}</dd>
        </div>
        <div>
          <dt>Latest</dt>
          <dd>{release?.latestVersion || 'Not checked'}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>{release?.publishedAt ? formatTimestamp(release.publishedAt) : 'Not checked'}</dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd>{release ? releaseStatusLabel(release.status) : 'Not checked'}</dd>
        </div>
        <div>
          <dt>Support</dt>
          <dd>{release ? supportStatusLabel(release.supportStatus) : 'Not checked'}</dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd>{release?.checkedAt ? formatTimestamp(release.checkedAt) : 'Never'}</dd>
        </div>
      </dl>
      {release?.note || error ? (
        <p
          className={`pp-tunnel-release-note ${error ? 'is-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error || release?.note}
        </p>
      ) : null}
      {release?.releaseUrl || release?.downloadsUrl ? (
        <div className="pp-tunnel-external-links">
          {release.releaseUrl ? (
            <a href={release.releaseUrl} target="_blank" rel="noreferrer noopener">
              Release details <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
          {release.downloadsUrl ? (
            <a href={release.downloadsUrl} target="_blank" rel="noreferrer noopener">
              Official downloads <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function InstallPanel({
  capabilities,
  cloudflaredFound,
  onNotice,
}: {
  capabilities: TunnelCapabilities | null;
  cloudflaredFound: boolean;
  onNotice: (value: string) => void;
}) {
  const install = capabilities?.install;
  if (!install) return null;
  return (
    <section className="pp-tunnel-install" aria-labelledby="tunnel-install-heading">
      <header>
        <Download aria-hidden="true" />
        <div>
          <span className="pp-tunnel-section-label">Official setup</span>
          <h3 id="tunnel-install-heading">
            {cloudflaredFound ? 'Install or update cloudflared' : 'Install cloudflared'}
          </h3>
          <p>
            Suggested for {platformLabel(install.platform)} · {install.architecture}. ProtoPeek
            never runs these commands automatically.
          </p>
        </div>
      </header>
      <div className="pp-tunnel-external-links">
        {install.downloadsUrl ? (
          <a href={install.downloadsUrl} target="_blank" rel="noreferrer noopener">
            Cloudflare Downloads <ExternalLink aria-hidden="true" />
          </a>
        ) : null}
        {install.releasesUrl ? (
          <a href={install.releasesUrl} target="_blank" rel="noreferrer noopener">
            GitHub Releases <ExternalLink aria-hidden="true" />
          </a>
        ) : null}
        {install.serviceDocsUrl ? (
          <a href={install.serviceDocsUrl} target="_blank" rel="noreferrer noopener">
            Service documentation <ExternalLink aria-hidden="true" />
          </a>
        ) : null}
      </div>
      {install.commands.length ? (
        <div className="pp-tunnel-command-list">
          {install.commands.map((item) => (
            <div key={item.id}>
              <span>
                <strong>{item.label}</strong>
                {item.requiresElevation ? <small>May require OS authorization</small> : null}
              </span>
              <code>{item.command}</code>
              <button
                type="button"
                aria-label={`Copy ${item.label}`}
                onClick={() => void copyText(item.command, onNotice)}
              >
                <Copy aria-hidden="true" /> Copy
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="pp-tunnel-privilege-note">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>
            ProtoPeek is {install.processElevated ? 'currently elevated' : 'not currently elevated'}
          </strong>
          <p>
            {displayElevationNotice(install.elevationNotice) ||
              'Your operating system may show UAC or request sudo/admin authorization.'}{' '}
            ProtoPeek never asks for, receives, or stores your password.
          </p>
        </div>
      </div>
    </section>
  );
}

function releaseStatusLabel(status: TunnelRelease['status']) {
  const labels: Record<TunnelRelease['status'], string> = {
    'not-installed': 'Not installed',
    current: 'Current',
    'update-available': 'Update available',
    newer: 'Newer than latest release',
    unknown: 'Unknown',
  };
  return labels[status];
}

function supportStatusLabel(status: TunnelRelease['supportStatus']) {
  const labels: Record<TunnelRelease['supportStatus'], string> = {
    supported: 'Supported',
    'out-of-support': 'Out of support',
    unknown: 'Unknown',
    'not-installed': 'Not installed',
  };
  return labels[status];
}

function platformLabel(platform: string) {
  if (platform === 'windows') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform || 'this operating system';
}

function displayElevationNotice(notice: string) {
  const cleaned = notice.replace(/[;,]?\s*ProtoPeek never asks for a password\.?\s*$/i, '').trim();
  return cleaned && !/[.!?]$/.test(cleaned) ? `${cleaned}.` : cleaned;
}
