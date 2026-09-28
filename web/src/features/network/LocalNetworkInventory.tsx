import { useMemo, useState } from 'react';
import type { LocalNetworkAdvertisements as NetworkAdvertisements } from '../../console/local-network';
import './local-inventory.css';
import type { LocalNetworkDiscovery, LocalNetworkInterface } from '../../console/local-network';
import {
  isAddressInLocalNetworkScope,
  type LocalNetworkDevice,
  localNetworkDevicesForInterface,
  type LocalNetworkInventory as NetworkInventory,
} from './local-network-inventory';

type BrowseDevice = Omit<LocalNetworkDevice, 'kind' | 'state' | 'source'> & {
  kind: 'self' | 'neighbor' | 'advertised';
};

export function LocalNetworkInventory({
  inventory,
  network,
  result,
}: {
  inventory: NetworkInventory;
  network: LocalNetworkInterface;
  result: LocalNetworkDiscovery | null;
}) {
  const devices = useMemo(() => {
    const combined = new Map<string, BrowseDevice>(
      localNetworkDevicesForInterface(inventory, network).map((device) => [device.address, device])
    );
    for (const record of result?.advertisements?.records ?? []) {
      if (!combined.has(record.address))
        combined.set(record.address, {
          address: record.address,
          interfaceIndex: network.index,
          interfaceName: network.name,
          mac: '',
          hostname: record.hostname,
          kind: 'advertised',
        });
    }
    return [...combined.values()];
  }, [inventory, network, result]);
  const [selectedAddress, setSelectedAddress] = useState(network.address);
  const [view, setView] = useState<'map' | 'list'>(() =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 640px)').matches
      ? 'list'
      : 'map'
  );
  const selected = devices.find((device) => device.address === selectedAddress) ?? devices[0];
  const observed = result?.hosts.find((host) => host.address === selected?.address);
  const wasInScan =
    result && selected ? isAddressInLocalNetworkScope(selected.address, result.cidr) : false;
  const advertisements =
    result?.advertisements?.records.filter((record) => record.address === selected?.address) ?? [];
  const labelFor = (device: BrowseDevice) =>
    device.kind === 'self'
      ? device.hostname || 'This device'
      : inventory.defaultInterfaceIndex === device.interfaceIndex &&
          inventory.defaultGateway === device.address
        ? 'Gateway'
        : (result?.advertisements?.records.find((record) => record.address === device.address)
            ?.hostname ??
          (device.hostname || device.address));
  const sourceFor = (device: BrowseDevice) =>
    device.kind === 'self'
      ? 'This device'
      : device.kind === 'neighbor'
        ? 'Cached neighbor'
        : device.kind === 'advertised'
          ? 'Advertised via mDNS'
          : 'Observed open service';
  const advertisedRole = advertisements.some((record) => /^_ipps?\._tcp\./.test(record.serviceType))
    ? 'Printer service · advertised via IPP'
    : advertisements.some((record) => /^_(airplay|googlecast)\._tcp\./.test(record.serviceType))
      ? 'Media receiver service · advertised'
      : '';

  return (
    <section className="pp-local-inventory" aria-label="Devices known to this computer">
      <header className="pp-local-inventory-heading">
        <div>
          <h3>Your network at a glance</h3>
          <p className="pp-scan-policy">
            {devices.filter((device) => device.kind === 'neighbor').length} cached neighbors · this
            device included. Read from this computer at{' '}
            <time dateTime={inventory.observedAt}>
              {new Date(inventory.observedAt).toLocaleTimeString()}
            </time>
            .
          </p>
        </div>
        <fieldset className="pp-local-inventory-view" aria-label="Device view">
          <button
            type="button"
            className="pp-button-secondary"
            aria-pressed={view === 'map'}
            onClick={() => setView('map')}
          >
            Map
          </button>
          <button
            type="button"
            className="pp-button-secondary"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
        </fieldset>
      </header>
      <p className="pp-scan-policy">
        {devices.length} known addresses. Cached devices may have left the network. Lines group
        addresses on this interface; they do not establish physical cables or live connectivity.
      </p>
      {inventory.status !== 'available' ? (
        <p className="pp-scan-message" role="status">
          {inventory.status === 'unavailable'
            ? 'Neighbor cache unavailable.'
            : 'Partial local inventory.'}{' '}
          Scan for open services to gather fresh evidence.
        </p>
      ) : null}
      {view === 'map' ? (
        <div className="pp-local-inventory-map">
          <svg
            viewBox={`0 0 800 ${130 + Math.ceil(Math.min(devices.length, 16) / 4) * 100}`}
            aria-label={`Known addresses on ${network.name}`}
          >
            <title>{network.name}: local network membership</title>
            <g className="pp-local-map-network">
              <rect x="255" y="12" width="290" height="52" rx="12" />
              <text x="400" y="35" textAnchor="middle">
                {network.name}
              </text>
              <text x="400" y="53" textAnchor="middle">
                {network.interfaceCidr}
              </text>
            </g>
            {devices.slice(0, 16).map((device, index) => {
              const rowCount = Math.min(
                4,
                Math.min(devices.length, 16) - Math.floor(index / 4) * 4
              );
              const x = (800 - rowCount * 200) / 2 + 100 + (index % 4) * 200;
              const y = 135 + Math.floor(index / 4) * 100;
              return (
                <g key={device.address}>
                  <path className="pp-local-map-link" d={`M400 64 V${y - 45} H${x} V${y - 25}`} />
                  <g
                    className={`pp-local-map-node${device.address === selected?.address ? ' is-active' : ''}`}
                  >
                    <rect x={x - 88} y={y - 25} width="176" height="60" rx="10" />
                    <text x={x} y={y - 2} textAnchor="middle">
                      {labelFor(device).length > 22
                        ? `${labelFor(device).slice(0, 21)}…`
                        : labelFor(device)}
                    </text>
                    <text x={x} y={y + 17} textAnchor="middle">
                      {inventory.defaultGateway === device.address
                        ? device.address
                        : sourceFor(device)}
                    </text>
                    <foreignObject x={x - 88} y={y - 25} width="176" height="60">
                      <button
                        type="button"
                        className="pp-local-map-hit"
                        aria-label={`Inspect ${labelFor(device)} (${device.address})`}
                        aria-pressed={device.address === selected?.address}
                        onClick={() => setSelectedAddress(device.address)}
                      />
                    </foreignObject>
                  </g>
                </g>
              );
            })}
          </svg>
          {devices.length > 16 ? (
            <p className="pp-scan-policy">
              Map shows the first 16 of {devices.length} addresses. Use List for every cached
              device.
            </p>
          ) : null}
        </div>
      ) : (
        <section className="pp-local-inventory-list" aria-label="Known devices">
          {devices.map((device) => (
            <button
              type="button"
              key={device.address}
              className={`pp-local-inventory-device${device.address === selected?.address ? ' is-active' : ''}`}
              aria-pressed={device.address === selected?.address}
              onClick={() => setSelectedAddress(device.address)}
            >
              <strong>{labelFor(device)}</strong>
              <span>{device.address}</span>
              <small>{sourceFor(device)}</small>
            </button>
          ))}
        </section>
      )}
      {selected ? (
        <article
          className="pp-local-inventory-detail"
          aria-label={`Device details for ${selected.address}`}
        >
          <header>
            <div>
              <span className="pp-kicker">{sourceFor(selected)}</span>
              <h4>{labelFor(selected)}</h4>
              <code>{selected.address}</code>
            </div>
            <div className="pp-local-device-actions">
              <a
                className="pp-button"
                href={`#/network/ports?host=${encodeURIComponent(selected.address)}`}
              >
                Inspect ports
              </a>
              <a
                className="pp-button"
                href={`#/network/packets?mode=live&host=${encodeURIComponent(selected.address)}`}
              >
                Inspect traffic
              </a>
            </div>
          </header>
          <dl>
            <div>
              <dt>Device type</dt>
              <dd>
                {selected.kind === 'self'
                  ? 'This computer'
                  : inventory.defaultGateway === selected.address
                    ? 'Gateway · observed in the kernel route'
                    : advertisedRole || 'Unknown · inspect services for clues'}
              </dd>
            </div>
            <div>
              <dt>Identity evidence</dt>
              <dd>
                {selected.kind === 'self'
                  ? 'Local interface and operating-system hostname'
                  : selected.kind === 'neighbor'
                    ? 'Operating-system IPv4 neighbor cache'
                    : selected.kind === 'advertised'
                      ? 'Device-provided mDNS/DNS-SD response'
                      : 'Positive TCP service response'}
                {selected.mac ? ` · MAC ${selected.mac}` : ''}
              </dd>
            </div>
            <div>
              <dt>Advertised name & services</dt>
              <dd>
                {advertisements.length ? (
                  <ul>
                    {advertisements.map((record) => (
                      <li key={`${record.instance}:${record.port}`}>
                        <strong>{record.hostname}</strong> · {record.serviceType} · advertised{' '}
                        {record.serviceType.includes('._udp.') ? 'UDP' : 'TCP'} {record.port}
                        <details>
                          <summary>mDNS evidence</summary>
                          <p>{record.instance}</p>
                          {record.txt.map((text) => (
                            <code key={text}>{text} </code>
                          ))}
                          <p>
                            Device-provided advertisement; an open port has not been established by
                            this record.
                          </p>
                        </details>
                      </li>
                    ))}
                  </ul>
                ) : result?.advertisements ? (
                  'No complete mDNS service advertisement was received for this address during the query.'
                ) : (
                  'Scan network to ask devices for mDNS names and services. The neighbor cache alone contains no advertisements.'
                )}
              </dd>
            </div>
            <div>
              <dt>TCP evidence for this address</dt>
              <dd>
                {observed
                  ? `${observed.ports.map((port) => `TCP ${port.port}`).join(', ')} · observed through the operating-system route`
                  : wasInScan
                    ? `No open selected TCP ports were observed for this address in the ${result?.complete ? 'completed' : 'partial'} scan.${result?.complete ? '' : ' Some probes may not have completed.'}`
                    : 'Not checked. Inspect ports for this device or scan the network below.'}
              </dd>
            </div>
          </dl>
          <p className="pp-scan-policy">
            TCP probes use this computer’s routing table. On overlapping networks, matching
            addresses can refer to different devices. Traffic inspection sees packets visible to the
            capture interface on this computer. A switched or encrypted network does not expose
            every other device’s traffic.
          </p>
        </article>
      ) : (
        <p className="pp-empty-copy">
          No cached addresses were available for this network. Scan network to check for open
          services.
        </p>
      )}
      <details className="pp-capability-boundaries">
        <summary>About this inventory</summary>
        <ul>
          {inventory.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </details>
      {result?.advertisements ? (
        <details className="pp-capability-boundaries">
          <summary>Advertisement collection · {result.advertisements.status}</summary>
          <ul>
            {result.advertisements.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function LocalNetworkAdvertisements({
  advertisements,
}: {
  advertisements: NetworkAdvertisements;
}) {
  return (
    <details className="pp-capability-boundaries">
      <summary>
        Advertised services · {advertisements.records.length} mDNS records · {advertisements.status}
      </summary>
      <p className="pp-scan-policy">
        These device-provided advertisements name services. They do not establish that the
        advertised ports are open.
      </p>
      <ul>
        {advertisements.records.map((record) => (
          <li key={`${record.address}:${record.instance}`}>
            <strong>{record.hostname}</strong> ({record.address}) · {record.serviceType} ·{' '}
            {record.serviceType.includes('._udp.') ? 'UDP' : 'TCP'} {record.port} ·{' '}
            {record.instance}
          </li>
        ))}
      </ul>
      <ul>
        {advertisements.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </details>
  );
}
