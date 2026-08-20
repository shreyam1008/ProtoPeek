import { FileUp, LoaderCircle, Play, ShieldCheck, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { classNames } from '@/shared/runtime';

import {
  importNmapXML,
  type NmapHostEvidence,
  type NmapImportResponse,
  type NmapPortEvidence,
  type ScanResult,
  scanAddresses,
} from './api';
import { ScanResultCard } from './DiscoveryScanner';

const maxNmapUploadBytes = 8 << 20;
const hostsPerPage = 8;
const portsPerPage = 24;

export function NmapImportPanel({
  active = true,
  onResults,
  onOpenGRPC,
  onOpenHTTP,
}: {
  active?: boolean;
  onResults: (results: ScanResult[]) => void;
  onOpenGRPC: (result: ScanResult) => void;
  onOpenHTTP: (result: ScanResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [inventory, setInventory] = useState<NmapImportResponse | null>(null);
  const [message, setMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const [activeEndpoint, setActiveEndpoint] = useState('');
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false);
  const [hostPage, setHostPage] = useState(0);
  const [verified, setVerified] = useState<Record<string, ScanResult[]>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!active) abortRef.current?.abort();
  }, [active]);

  const usableCount = useMemo(() => {
    if (!inventory) return 0;
    return inventory.hosts.reduce(
      (count, host) => count + host.ports.filter((port) => usableEndpoint(host, port)).length,
      0
    );
  }, [inventory]);
  const hostPageCount = Math.max(1, Math.ceil((inventory?.hosts.length ?? 0) / hostsPerPage));
  const visibleHosts = inventory?.hosts.slice(
    hostPage * hostsPerPage,
    (hostPage + 1) * hostsPerPage
  );
  const busy = importing || Boolean(activeEndpoint);

  async function handleImport() {
    if (!file || importing) return;
    if (file.size > maxNmapUploadBytes) {
      setMessage('Nmap XML exceeds the 8 MiB import limit.');
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setImporting(true);
    setMessage('');
    setInventory(null);
    setHostPage(0);
    setVerified({});
    try {
      setInventory(await importNmapXML(file, controller.signal));
    } catch (reason) {
      setMessage(
        controller.signal.aborted
          ? 'Nmap XML import cancelled.'
          : reason instanceof Error
            ? reason.message.trim()
            : 'Nmap XML import failed.'
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setImporting(false);
    }
  }

  function clearFile() {
    abortRef.current?.abort();
    setFile(null);
    setInventory(null);
    setMessage('');
    setHostPage(0);
    setVerified({});
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function verifyEndpoint(endpoint: string) {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setActiveEndpoint(endpoint);
    setMessage('');
    try {
      const results = await scanAddresses([endpoint], allowPrivateNetwork, true, controller.signal);
      setVerified((current) => ({ ...current, [endpoint]: results }));
      onResults(results);
    } catch (reason) {
      setMessage(
        controller.signal.aborted
          ? 'ProtoPeek verification cancelled.'
          : reason instanceof Error
            ? reason.message.trim()
            : 'ProtoPeek verification failed.'
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setActiveEndpoint('');
    }
  }

  return (
    <div className="pp-nmap-import" aria-busy={busy}>
      <p className="pp-scan-policy">
        Import an existing <code>nmap -oX</code> file. ProtoPeek does not install, locate, or run
        Nmap, and discards command arguments, scripts, OS guesses, and traces.
      </p>
      <div className="pp-nmap-file-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/xml,.xml"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            setFile(selected);
            setInventory(null);
            setVerified({});
            setHostPage(0);
            setMessage(
              selected && selected.size > maxNmapUploadBytes
                ? 'Nmap XML exceeds the 8 MiB import limit.'
                : ''
            );
          }}
        />
        <button
          type="button"
          className="pp-button-secondary"
          disabled={busy}
          onClick={() => {
            if (fileInputRef.current) fileInputRef.current.value = '';
            fileInputRef.current?.click();
          }}
        >
          <FileUp aria-hidden="true" /> Choose XML
        </button>
        <span>
          {file ? `${file.name} · ${formatBytes(file.size)}` : 'No file selected · limit 8 MiB'}
        </span>
        {file ? (
          <button
            type="button"
            className="pp-button-secondary pp-nmap-clear-file"
            disabled={busy}
            onClick={clearFile}
          >
            <X aria-hidden="true" /> Clear
          </button>
        ) : null}
        <button
          type="button"
          className={classNames('pp-button-primary', importing && 'pp-cancel-button')}
          disabled={!file || file.size > maxNmapUploadBytes || Boolean(activeEndpoint)}
          onClick={importing ? () => abortRef.current?.abort() : () => void handleImport()}
        >
          {importing ? <Square aria-hidden="true" /> : <FileUp aria-hidden="true" />}
          {importing ? 'Cancel import' : 'Import evidence'}
        </button>
      </div>
      <label className="pp-private-scan-toggle">
        <input
          type="checkbox"
          checked={allowPrivateNetwork}
          onChange={(event) => setAllowPrivateNetwork(event.target.checked)}
        />
        Allow verification of imported private IPs
      </label>
      <aside className="pp-nmap-trust-note">
        <ShieldCheck aria-hidden="true" />
        <p>
          Service names are untrusted hints. Verify with ProtoPeek&apos;s existing bounded TCP,
          gRPC, TLS, and HTTP scanner before a protocol workbench can open.
        </p>
      </aside>
      {importing ? (
        <div className="pp-scan-progress" role="status">
          <LoaderCircle aria-hidden="true" /> Parsing bounded XML evidence…
        </div>
      ) : null}
      {message ? (
        <p className="pp-scan-message" role="alert">
          {message}
        </p>
      ) : null}
      {inventory ? (
        <section className="pp-nmap-results" aria-label="Imported Nmap evidence">
          <header>
            <span>
              {inventory.hostCount} host(s) · {inventory.portCount} port(s)
            </span>
            <span>{usableCount} open TCP endpoint(s) can be verified</span>
          </header>
          {!inventory.complete ? (
            <p className="pp-nmap-partial" role="status">
              This report has no successful completion marker
              {inventory.completion && inventory.completion !== 'missing'
                ? ` (${inventory.completion})`
                : ''}
              . Treat every result as partial evidence.
            </p>
          ) : null}
          {visibleHosts?.map((host) => (
            <NmapHostCard
              key={host.id}
              host={host}
              activeEndpoint={activeEndpoint}
              verified={verified}
              onVerify={verifyEndpoint}
              onCancel={() => abortRef.current?.abort()}
              onOpenGRPC={onOpenGRPC}
              onOpenHTTP={onOpenHTTP}
            />
          ))}
          {hostPageCount > 1 ? (
            <nav className="pp-nmap-pagination" aria-label="Imported host pages">
              <button
                type="button"
                disabled={hostPage === 0}
                onClick={() => setHostPage((page) => page - 1)}
              >
                Previous hosts
              </button>
              <span>
                Hosts {hostPage * hostsPerPage + 1}–
                {Math.min((hostPage + 1) * hostsPerPage, inventory.hosts.length)} of{' '}
                {inventory.hosts.length}
              </span>
              <button
                type="button"
                disabled={hostPage + 1 >= hostPageCount}
                onClick={() => setHostPage((page) => page + 1)}
              >
                Next hosts
              </button>
            </nav>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function NmapHostCard({
  host,
  activeEndpoint,
  verified,
  onVerify,
  onCancel,
  onOpenGRPC,
  onOpenHTTP,
}: {
  host: NmapHostEvidence;
  activeEndpoint: string;
  verified: Record<string, ScanResult[]>;
  onVerify: (endpoint: string) => Promise<void>;
  onCancel: () => void;
  onOpenGRPC: (result: ScanResult) => void;
  onOpenHTTP: (result: ScanResult) => void;
}) {
  const [portPage, setPortPage] = useState(0);
  const portPageCount = Math.max(1, Math.ceil(host.ports.length / portsPerPage));
  const visiblePorts = host.ports.slice(portPage * portsPerPage, (portPage + 1) * portsPerPage);
  return (
    <article className="pp-nmap-host">
      <header>
        <div>
          <strong>{hostLabel(host)}</strong>
          <small>
            {host.status.state || 'state unknown'} · {host.status.reason || 'no reason'}
          </small>
        </div>
        <span>{host.ports.length} port(s)</span>
      </header>
      {host.addresses.length || host.hostnames.length ? (
        <div className="pp-nmap-identities">
          {host.addresses.map((address) => (
            <span key={`${address.type}-${address.address}`}>
              {address.address} · {address.type || 'address'}
              {address.vendor ? ` · ${address.vendor}` : ''}
            </span>
          ))}
          {host.hostnames.map((hostname) => (
            <span key={`${hostname.type}-${hostname.name}`}>
              {hostname.name} · {hostname.type || 'hostname'}
            </span>
          ))}
        </div>
      ) : null}
      <div className="pp-nmap-ports">
        {visiblePorts.map((port) => {
          const endpoint = usableEndpoint(host, port);
          const hint = [port.service.product, port.service.version, port.service.extrainfo]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={`${port.protocol}-${port.port}`} className="pp-nmap-port">
              <div className="pp-nmap-port-main">
                <strong>
                  {port.port}/{port.protocol || 'unknown'}
                </strong>
                <span>
                  {port.state || 'unknown'}
                  {port.reason ? ` · ${port.reason}` : ''}
                </span>
              </div>
              <div className="pp-nmap-service-hint">
                <span>
                  {port.service.name || 'No service hint'}
                  {port.service.tunnel ? ` · tunnel ${port.service.tunnel}` : ''}
                </span>
                {hint ? <small>{hint}</small> : null}
                <em className={classNames(port.service.method === 'probed' && 'is-probed')}>
                  {port.service.method || 'method unknown'}
                  {port.service.confidence ? ` · confidence ${port.service.confidence}` : ''}
                </em>
              </div>
              {endpoint ? (
                <button
                  type="button"
                  disabled={Boolean(activeEndpoint) && activeEndpoint !== endpoint}
                  aria-label={
                    activeEndpoint === endpoint
                      ? `Cancel verification of ${endpoint}`
                      : `Verify ${endpoint} with ProtoPeek`
                  }
                  onClick={activeEndpoint === endpoint ? onCancel : () => void onVerify(endpoint)}
                >
                  {activeEndpoint === endpoint ? (
                    <Square aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  {activeEndpoint === endpoint ? 'Cancel verification' : 'Verify with ProtoPeek'}
                </button>
              ) : (
                <small className="pp-nmap-unusable">
                  Bounded verification supports open TCP endpoints.
                </small>
              )}
              {endpoint && verified[endpoint]?.length ? (
                <div className="pp-nmap-verification">
                  {verified[endpoint].map((result) => (
                    <ScanResultCard
                      key={`${endpoint}-${result.transport}-${result.httpTransport}`}
                      result={result}
                      onOpenGRPC={onOpenGRPC}
                      onOpenHTTP={onOpenHTTP}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {portPageCount > 1 ? (
          <nav className="pp-nmap-pagination" aria-label={`Port pages for ${hostLabel(host)}`}>
            <button
              type="button"
              disabled={portPage === 0}
              onClick={() => setPortPage((page) => page - 1)}
            >
              Previous ports
            </button>
            <span>
              Ports {portPage * portsPerPage + 1}–
              {Math.min((portPage + 1) * portsPerPage, host.ports.length)} of {host.ports.length}
            </span>
            <button
              type="button"
              disabled={portPage + 1 >= portPageCount}
              onClick={() => setPortPage((page) => page + 1)}
            >
              Next ports
            </button>
          </nav>
        ) : null}
      </div>
    </article>
  );
}

function hostLabel(host: NmapHostEvidence) {
  return (
    verificationTarget(host) ||
    host.addresses[0]?.address ||
    host.hostnames[0]?.name ||
    'Unnamed imported host'
  );
}

function usableEndpoint(host: NmapHostEvidence, port: NmapPortEvidence) {
  if (
    port.protocol.toLowerCase() !== 'tcp' ||
    port.state.toLowerCase() !== 'open' ||
    port.port < 1 ||
    port.port > 65535
  )
    return '';
  const target = verificationTarget(host);
  if (!target) return '';
  const hostPart = target.includes(':') && !target.startsWith('[') ? `[${target}]` : target;
  return `${hostPart}:${port.port}`;
}

function verificationTarget(host: NmapHostEvidence) {
  return host.addresses.find((address) => isLiteralAddress(address.type, address.address))?.address;
}

function isLiteralAddress(type: string, value: string) {
  if (type.toLowerCase() === 'ipv4') {
    const octets = value.split('.');
    return (
      octets.length === 4 &&
      octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
    );
  }
  if (type.toLowerCase() !== 'ipv6' || !value.includes(':') || value.includes('%')) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.startsWith('[');
  } catch {
    return false;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1 << 20) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1 << 20)).toFixed(1)} MiB`;
}
