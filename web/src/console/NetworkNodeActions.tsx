import { type NetworkIdentity, validIdentity } from './network-model';

export default function NetworkNodeActions({
  identities,
}: {
  identities: readonly NetworkIdentity[];
}) {
  const targets = identities.map(inspectionTarget).filter((target) => target !== null);
  const portTarget =
    targets.find((target) => target.ports && target.packets)?.host ??
    targets.find((target) => target.ports)?.host;
  const packetTarget =
    targets.find((target) => target.packets && target.host === portTarget)?.host ??
    targets.find((target) => target.packets)?.host;
  return (
    <section aria-label="Inspect selected device">
      <h3>Inspect this device</h3>
      <div className="pp-network-export-actions">
        {portTarget ? (
          <a
            className="pp-button-secondary"
            href={`#/network/ports?host=${encodeURIComponent(portTarget)}`}
          >
            Scan ports
          </a>
        ) : null}
        {packetTarget ? (
          <a
            className="pp-button-secondary"
            href={`#/network/packets?mode=live&host=${encodeURIComponent(packetTarget)}`}
          >
            Inspect traffic
          </a>
        ) : null}
      </div>
      {portTarget || packetTarget ? (
        <p>
          Target: <code>{portTarget || packetTarget}</code>
          {packetTarget && portTarget && packetTarget !== portTarget ? (
            <>
              {' '}
              · Traffic: <code>{packetTarget}</code>
            </>
          ) : null}
          . Opens a draft; start the check in its tool.
        </p>
      ) : null}
      {!portTarget ? <p>No supported IP address or hostname is saved for port scanning.</p> : null}
      {!packetTarget ? <p>Traffic inspection needs an unscoped unicast IP identity.</p> : null}
    </section>
  );
}

function inspectionTarget(identity: NetworkIdentity) {
  const { kind, value } = identity;
  if (
    !['ipv4', 'ipv6', 'hostname'].includes(kind) ||
    value.length > 253 ||
    /\s/.test(value) ||
    !validIdentity(kind, value)
  )
    return null;
  if (kind === 'hostname') {
    if (/^[\d.]+$/.test(value)) return null;
    return { host: value, ports: true, packets: false };
  }
  if (kind === 'ipv4') {
    const first = Number(value.split('.')[0]);
    if (value === '0.0.0.0' || value === '255.255.255.255' || (first >= 224 && first <= 239))
      return null;
    return { host: value, ports: !value.startsWith('169.254.'), packets: true };
  }
  // These tools do not support a scoped IPv6 target.
  if (value.includes('%')) return null;
  const host = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  if (host === '::' || host.startsWith('ff')) return null;
  return { host, ports: !/^fe[89ab][0-9a-f]:/.test(host), packets: true };
}
