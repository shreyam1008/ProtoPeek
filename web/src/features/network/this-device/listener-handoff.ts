import { formatHostPort, normalizeHandoffTimestamp } from '@/console/app/handoff-store';
import type { HandoffDraft, HandoffKind, PendingHandoffInput } from '@/console/app/handoff-types';
import type { ThisPCSocket } from '@/console/this-pc-api';

export type ListenerHandoffKind = Extract<
  HandoffKind,
  'http-url-draft' | 'grpc-target-draft' | 'next-hop-target-draft' | 'publish-origin-draft'
>;

export type ListenerHandoffResult =
  | { ok: true; value: PendingHandoffInput }
  | { ok: false; error: string };

function listenerHost(socket: ThisPCSocket) {
  if (!socket.local.wildcard) return socket.local.address.trim();
  return socket.protocol === 'tcp6' ? '::1' : '127.0.0.1';
}

export function listenerIPv6ScopeMissing(socket: ThisPCSocket) {
  const address = socket.local.address.trim();
  return (
    socket.protocol === 'tcp6' &&
    !socket.local.wildcard &&
    !address.includes('%') &&
    /^fe[89ab]/i.test(address)
  );
}

export function createListenerHandoff(
  socket: ThisPCSocket,
  observedAt: string,
  kind: ListenerHandoffKind
): ListenerHandoffResult {
  if (socket.protocol !== 'tcp4' && socket.protocol !== 'tcp6') {
    return { ok: false, error: 'Only observed TCP listeners can become workbench drafts.' };
  }
  if (listenerIPv6ScopeMissing(socket)) {
    return { ok: false, error: 'IPv6 scope missing' };
  }
  if (!Number.isInteger(socket.local.port) || socket.local.port < 1 || socket.local.port > 65_535) {
    return { ok: false, error: 'This listener has an invalid local port.' };
  }
  const evidence = normalizeHandoffTimestamp(observedAt);
  const evidenceTime = evidence?.[0];
  const host = listenerHost(socket);
  if (!evidenceTime || !host) {
    return { ok: false, error: 'This listener is missing usable endpoint evidence.' };
  }
  const localHostInferred = socket.local.wildcard;
  const endpoint = formatHostPort(host, socket.local.port);
  const likelyTLS = [443, 8443, 9443].includes(socket.local.port);
  let draft: HandoffDraft;

  if (kind === 'http-url-draft') {
    draft = {
      kind,
      target: {
        kind: 'http-url',
        url: `${likelyTLS ? 'https' : 'http'}://${endpoint}/`,
      },
    };
  } else if (kind === 'grpc-target-draft') {
    draft = {
      kind,
      target: { kind: 'grpc-target', address: endpoint, plaintext: !likelyTLS },
    };
  } else if (kind === 'next-hop-target-draft') {
    draft = { kind, target: { kind: 'next-hop-target', target: host } };
  } else {
    draft = {
      kind,
      origin: {
        kind: 'local-service',
        perspective: 'process-network-namespace',
        network: 'tcp',
        bind: {
          address: socket.local.address,
          wildcard: socket.local.wildcard,
        },
        exposure: socket.exposure,
        protocol: 'tcp',
        host,
        port: socket.local.port,
      },
    };
  }
  return {
    ok: true,
    value: {
      provenance: {
        source: 'this-device',
        quality: kind === 'next-hop-target-draft' && !localHostInferred ? 'observed' : 'inferred',
        observedAt: evidenceTime,
        path: '/this-pc',
      },
      draft,
    },
  };
}
