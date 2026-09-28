import { Link, useSearch } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/console/shell/EmptyState';
import { PageHeader } from '@/console/shell/PageHeader';
import { ProtocolInfo } from './ProtocolInfo';
import {
  type CaptureInterface,
  type PacketReport,
  packetRequest,
  parsePacketReport,
} from './packet-api';
import { OperationStatus } from './shell/OperationStatus';
import './packets.css';

const PacketReportView = lazy(() => import('./PacketReportView'));

export function PacketWorkbench() {
  const incoming = useSearch({ from: '/network/packets' });
  const [mode, setMode] = useState(
    incoming.mode ?? (incoming.host || incoming.port ? 'live' : 'file')
  );
  const [file, setFile] = useState<File | null>(null);
  const [interfaces, setInterfaces] = useState<CaptureInterface[]>([]);
  const [iface, setIface] = useState('');
  const [host, setHost] = useState(incoming.host ?? '');
  const [port, setPort] = useState(incoming.port ?? '');
  const [seconds, setSeconds] = useState('5');
  const [capability, setCapability] = useState('Checking capture support…');
  const [captureAvailable, setCaptureAvailable] = useState<boolean | null>(null);
  const [interfaceBusy, setInterfaceBusy] = useState(false);
  const [interfaceError, setInterfaceError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<PacketReport | null>(null);
  const [source, setSource] = useState('');
  const [reportRevision, setReportRevision] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    if (captureAvailable !== null) return;
    const controller = new AbortController();
    void packetRequest('capabilities', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setCaptureAvailable(value.available === true);
          setCapability(
            value.available === true
              ? 'Capture tool found. Choose where traffic enters or leaves this ProtoPeek host.'
              : typeof value.reason === 'string'
                ? value.reason
                : 'Capture support unavailable.'
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCaptureAvailable(false);
          setCapability('Could not check capture support. Offline inspection is available.');
        }
      });
    return () => controller.abort();
  }, [captureAvailable]);
  useEffect(() => {
    if (mode !== 'live' || captureAvailable !== true) return;
    const controller = new AbortController();
    setInterfaceBusy(true);
    setInterfaceError('');
    void packetRequest('interfaces', {}, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          !Array.isArray(result) ||
          result.length > 64 ||
          new Set(result.map((item) => item?.name)).size !== result.length ||
          result.some(
            (item) =>
              !item ||
              typeof item.name !== 'string' ||
              !item.name ||
              item.name.length > 320 ||
              typeof item.label !== 'string' ||
              item.label.length > 512
          )
        )
          throw new Error('Invalid interface listing.');
        setInterfaces(result);
        setIface((old) =>
          result.some((item) => item.name === old) ? old : result.length === 1 ? result[0].name : ''
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setInterfaces([]);
          setIface('');
          setInterfaceError(cause instanceof Error ? cause.message : 'Could not read interfaces.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setInterfaceBusy(false);
      });
    return () => controller.abort();
  }, [mode, captureAvailable]);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    []
  );
  function cancel() {
    active.current?.abort();
    active.current = null;
    setBusy('');
    setNotice('Cancelled. This run was discarded; earlier results remain.');
  }
  async function run(operation: 'analyze' | 'capture') {
    if (active.current) return;
    setError('');
    setNotice('');
    if (operation === 'analyze' && (!file || file.size > 16 * 1024 * 1024)) {
      setError('Choose a capture file up to 16 MiB.');
      return;
    }
    if (operation === 'capture') {
      if (
        captureAvailable !== true ||
        interfaceBusy ||
        !interfaces.some((item) => item.name === iface)
      ) {
        setError('Choose an available local capture interface.');
        return;
      }
      if (!host.trim() && !port) {
        setError('Choose one IP or port to capture.');
        return;
      }
      if (
        (port && (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)) ||
        !Number.isInteger(Number(seconds)) ||
        Number(seconds) < 1 ||
        Number(seconds) > 30
      ) {
        setError('Use a port from 1–65535 and a duration from 1–30 seconds.');
        return;
      }
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(operation === 'capture' ? `Capturing for up to ${seconds} seconds` : 'Reading capture');
    try {
      const input =
        operation === 'analyze'
          ? file
          : {
              interface: iface,
              host: host.trim(),
              port: Number(port),
              seconds: Number(seconds),
              packets: 2000,
              consent: true,
            };
      const result = await packetRequest(operation, input, controller.signal);
      if (active.current !== controller) return;
      setReport(parsePacketReport(result));
      setSource(
        operation === 'analyze'
          ? (file?.name ?? 'Capture file')
          : `${interfaces.find((item) => item.name === iface)?.label ?? iface} · ${host || 'any host'} · port ${port || 'any'}`
      );
      setReportRevision((revision) => revision + 1);
      setNotice('Inspection completed. Results stay in memory until cleared or this page closes.');
    } catch (cause) {
      if (active.current === controller)
        setError(cause instanceof Error ? cause.message : 'Packet inspection failed.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy('');
      }
    }
  }
  return (
    <div className="pp-packets">
      <PageHeader>
        <h1>Packet inspection</h1>
        <ProtocolInfo protocol="packets" />
        <Link to="/network/local">Network tools</Link>
      </PageHeader>
      <aside className="pp-packet-controls" aria-label="Packet inspection controls">
        <nav aria-label="Packet sources">
          <button
            type="button"
            aria-pressed={mode === 'file'}
            disabled={Boolean(busy)}
            onClick={() => setMode('file')}
          >
            Open capture file
          </button>
          <button
            type="button"
            aria-pressed={mode === 'live'}
            disabled={Boolean(busy)}
            onClick={() => setMode('live')}
          >
            Capture this host
          </button>
        </nav>
        {mode === 'file' ? (
          <>
            <label>
              PCAP / PCAPNG file
              <input
                type="file"
                aria-label="Packet capture file"
                accept=".pcap,.pcapng,.cap"
                disabled={Boolean(busy)}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              disabled={!file || Boolean(busy)}
              onClick={() => void run('analyze')}
            >
              Inspect file
            </button>
            <small>
              Up to 16 MiB. File bytes go to this ProtoPeek server for analysis. No packets are sent
              to captured endpoints.
            </small>
          </>
        ) : (
          <>
            <div className="pp-packet-visibility">
              <strong>Traffic visible to this host</strong>
              <p>
                Record packets on a local interface. For another device, this normally shows its
                traffic to or from this host; a switched network does not expose all of that
                device’s traffic here.
              </p>
              <p>HTTPS and other encrypted traffic remains encrypted.</p>
            </div>
            <p className="pp-packet-capability" role="status">
              {capability}
            </p>
            <button
              type="button"
              disabled={Boolean(busy) || interfaceBusy}
              onClick={() => {
                setCaptureAvailable(null);
                setCapability('Checking capture support…');
              }}
            >
              Refresh interfaces
            </button>
            {interfaceBusy ? <p role="status">Finding local capture interfaces…</p> : null}
            {interfaceError ? <p role="alert">{interfaceError}</p> : null}
            {captureAvailable === true &&
            !interfaceBusy &&
            !interfaceError &&
            !interfaces.length ? (
              <p role="status">
                No capture interfaces are available. Check the capture driver and OS permissions,
                then refresh.
              </p>
            ) : null}
            <label>
              Interface
              <select
                value={iface}
                disabled={Boolean(busy) || interfaceBusy || !interfaces.length}
                onChange={(event) => {
                  setIface(event.target.value);
                }}
              >
                <option value="">Choose an interface</option>
                {interfaces.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <small>
              Choose Wi-Fi or Ethernet for network traffic; choose loopback for connections within
              this machine. Interfaces belong to the machine running ProtoPeek.
            </small>
            <label>
              IP filter
              <input
                value={host}
                placeholder="127.0.0.1 or another IP"
                maxLength={64}
                disabled={Boolean(busy)}
                onChange={(event) => setHost(event.target.value)}
              />
            </label>
            <small>Use an IP address, or leave it empty when filtering by port.</small>
            <div className="pp-packet-options">
              <label>
                Port filter
                <input
                  type="number"
                  value={port}
                  min={1}
                  max={65535}
                  disabled={Boolean(busy)}
                  onChange={(event) => setPort(event.target.value)}
                />
              </label>
              <label>
                Duration (seconds)
                <input
                  type="number"
                  value={seconds}
                  min={1}
                  max={30}
                  disabled={Boolean(busy)}
                  onChange={(event) => setSeconds(event.target.value)}
                />
              </label>
            </div>
            <details>
              <summary>Capture limits and filter rules</summary>
              <p>
                IP and port filters combine with AND. Up to 2,000 packets, 512 bytes each. Capture
                does not request promiscuous mode. Results appear when the run ends.
              </p>
              <p>
                Port filters include TCP and UDP. Capture does not generate traffic; use the service
                during the capture window.
              </p>
            </details>
            <div className="pp-packet-consent">
              Start capture records traffic matching the selected interface and filter.
            </div>
            <button
              type="button"
              disabled={
                captureAvailable !== true ||
                interfaceBusy ||
                !iface ||
                (!host.trim() && !port) ||
                Boolean(busy)
              }
              onClick={() => void run('capture')}
            >
              Start capture
            </button>
            <a
              href="https://wiki.wireshark.org/CaptureSetup/CapturePrivileges"
              target="_blank"
              rel="noreferrer"
            >
              Capture setup and permissions
            </a>
            <small>
              Windows needs Npcap capture support. Linux needs capture permission for dumpcap.
              Follow the platform setup guide, then refresh interfaces.
            </small>
          </>
        )}
        {busy ? (
          <button type="button" onClick={cancel}>
            Cancel inspection
          </button>
        ) : null}
        <details>
          <summary>What this reader shows</summary>
          <p>
            Endpoints, packet sizes, TCP flags, DNS questions, HTTP method/status and TLS record
            signatures. Port numbers alone do not identify an application.
          </p>
          <p>
            No TCP reassembly, decryption, process attribution or payload retention. Use Wireshark
            for deeper inspection of your original capture.
          </p>
        </details>
      </aside>
      <section className="pp-packet-results" aria-label="Packet results">
        {error ? <p role="alert">{error}</p> : null}
        <OperationStatus busy={Boolean(busy)} label={busy || 'Inspecting packets'} />
        {busy || notice ? <p role="status">{busy || notice}</p> : null}
        {report ? (
          <Suspense fallback={<p role="status">Preparing packet results…</p>}>
            <PacketReportView
              key={reportRevision}
              report={report}
              source={source}
              busy={Boolean(busy)}
              onClear={() => {
                setReport(null);
                setSource('');
                setNotice('Results cleared. The original capture file is unchanged.');
              }}
            />
          </Suspense>
        ) : (
          <EmptyState title="See what crossed a network interface">
            Open an existing capture, or explicitly capture one IP or port on this host. Choose a
            packet to inspect its decoded details.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
