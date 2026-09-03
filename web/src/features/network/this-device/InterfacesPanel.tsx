import { ChevronRight, Network } from 'lucide-react';

import type { ThisPCInterface, ThisPCSnapshot } from '@/console/this-pc-api';

import { formatDecimalBytes } from './device-format';
import type { Resource } from './device-state';

function InterfaceRow({ item }: { item: ThisPCInterface }) {
  const up = item.flags.some((flag) => flag.toLowerCase() === 'up');
  return (
    <article className="this-pc-interface-row">
      <div className="this-pc-interface-name">
        <Network aria-hidden="true" />
        <span>
          <strong>{item.name}</strong>
          <small>
            <i className={up ? 'is-up' : undefined} aria-hidden="true" />
            {item.flags.length ? item.flags.join(', ') : 'No flags reported'}
          </small>
        </span>
      </div>
      <div className="this-pc-interface-addresses">
        {item.addresses.length ? (
          item.addresses.map((address) => (
            <span key={`${address.family}-${address.address}-${address.prefix}`}>
              <b>{address.family === 'ipv4' ? 'IPv4' : 'IPv6'}</b>
              <code>
                {address.address}/{address.prefix}
              </code>
              <small>{address.scope}</small>
            </span>
          ))
        ) : (
          <span>
            <b>Address</b>
            <code>Not reported</code>
          </span>
        )}
      </div>
      <div className="this-pc-interface-meta">
        <span>
          <b>MTU</b>
          <code>{item.mtu === -1 ? 'Not reported' : item.mtu}</code>
        </span>
        {item.traffic ? (
          <span>
            <b>Counters</b>
            <code>
              RX {formatDecimalBytes(item.traffic.receivedBytes)} · TX{' '}
              {formatDecimalBytes(item.traffic.transmittedBytes)}
            </code>
          </span>
        ) : null}
      </div>
      <ChevronRight aria-hidden="true" />
    </article>
  );
}

export function InterfacesPanel({ snapshot }: { snapshot: Resource<ThisPCSnapshot> }) {
  return (
    <section
      className="this-pc-panel this-pc-interfaces"
      aria-labelledby="this-pc-interfaces-title"
    >
      <header>
        <div>
          <h2 id="this-pc-interfaces-title">Interfaces</h2>
          <p>Addresses and counters reported by the local process/network namespace.</p>
        </div>
        {snapshot.status === 'ready' ? (
          <span>{snapshot.value.interfaces.length} observed</span>
        ) : null}
      </header>
      {snapshot.status === 'ready' ? (
        snapshot.value.interfaces.length ? (
          <div className="this-pc-interface-list">
            {snapshot.value.interfaces.map((item) => (
              <InterfaceRow key={item.index} item={item} />
            ))}
          </div>
        ) : (
          <p className="this-pc-empty">
            No interfaces were reported by this process/network namespace.
          </p>
        )
      ) : (
        <p className="this-pc-empty">
          {snapshot.status === 'error'
            ? 'Interface evidence is unavailable.'
            : 'Reading interfaces…'}
        </p>
      )}
    </section>
  );
}
