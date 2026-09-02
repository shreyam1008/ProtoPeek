import { CircleAlert } from 'lucide-react';

import { StatusFact } from '@/console/evidence/StatusFact';
import type { ThisPCSnapshot } from '@/console/this-pc-api';

import type { Resource } from './device-state';

function formatUptime(value?: string) {
  if (!value) return 'Not reported';
  const seconds = BigInt(value);
  const days = seconds / BigInt(86_400);
  const hours = (seconds % BigInt(86_400)) / BigInt(3600);
  const minutes = (seconds % BigInt(3600)) / BigInt(60);
  return `${days.toString()}d ${hours.toString()}h ${minutes.toString()}m`;
}

export function DeviceSummary({ snapshot }: { snapshot: Resource<ThisPCSnapshot> }) {
  if (snapshot.status === 'loading') {
    return (
      <div className="this-pc-summary this-pc-loading" role="status">
        Reading local machine identity…
      </div>
    );
  }
  if (snapshot.status === 'error') {
    return (
      <div className="this-pc-summary this-pc-error" role="alert">
        <CircleAlert aria-hidden="true" />
        <span>{snapshot.error}</span>
      </div>
    );
  }
  const value = snapshot.value;
  return (
    <section className="this-pc-summary" aria-label="Local machine identity">
      <dl>
        <StatusFact label="Host name" value={value.hostname ?? 'Not reported'} />
        <StatusFact label="OS" value={value.os} />
        <StatusFact label="Architecture" value={value.arch} />
        <StatusFact label="Logical CPUs" value={value.logicalCpus} />
        <StatusFact label="Uptime" value={formatUptime(value.linuxSystem?.uptimeSeconds)} />
        <StatusFact label="Scope" value="Local process/network namespace" />
      </dl>
      <p>{value.scopeNotice}</p>
    </section>
  );
}
