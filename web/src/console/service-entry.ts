import type { PendingHandoffInput } from './app/handoff-types';

export type ServiceWorkbench = 'http' | 'grpc-tls' | 'grpc-plaintext';
type ServiceEntry = { ok: true; handoff: PendingHandoffInput } | { ok: false; error: string };

/** Prepare a manual draft. This parser never probes or guesses a remote HTTP transport. */
export function prepareServiceEntry(value: string, workbench: ServiceWorkbench): ServiceEntry {
  const input = value.trim();
  const maximum = workbench === 'http' ? 2048 : 512;
  if (!input) return { ok: false, error: 'Enter the address you want to open.' };
  if (new TextEncoder().encode(input).length > maximum)
    return { ok: false, error: `Use an address of at most ${maximum} bytes.` };
  if (
    /[\s\\]/.test(input) ||
    [...input].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return {
      ok: false,
      error: 'Remove spaces, control characters and backslashes from the address.',
    };
  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
    const parsed = new URL(absolute ? input : `http://${input}`);
    if (parsed.username || parsed.password)
      return {
        ok: false,
        error: 'Remove credentials from the address. Add auth in the workbench.',
      };
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || input.endsWith(':'))
      throw new Error();
    const provenance = {
      source: 'home-entry',
      quality: 'manual' as const,
      observedAt: new Date().toISOString(),
      path: '/',
    };
    if (workbench === 'http') {
      if (input.startsWith('//') || parsed.href.length > maximum)
        return { ok: false, error: 'Use a complete HTTP(S) URL of at most 2048 characters.' };
      if (!absolute && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase()))
        return {
          ok: false,
          error: 'Use an explicit http:// or https:// URL for a remote service.',
        };
      return {
        ok: true,
        handoff: {
          provenance,
          draft: { kind: 'http-url-draft', target: { kind: 'http-url', url: parsed.href } },
        },
      };
    }
    if (parsed.pathname !== '/' || parsed.search || parsed.hash)
      return {
        ok: false,
        error: 'Use a host and port for gRPC. Remove the path, query and fragment.',
      };
    const plaintext = workbench === 'grpc-plaintext';
    if (absolute && (parsed.protocol === 'http:') !== plaintext)
      return {
        ok: false,
        error: `Choose gRPC · ${parsed.protocol === 'http:' ? 'plaintext' : 'TLS'} to match the address.`,
      };
    // URL canonicalization removes default ports, so also inspect the original authority.
    const authority = absolute ? input.split('://')[1].split('/')[0] : input;
    const explicitPort = authority.match(/:(\d{1,5})$/)?.[1];
    if ((!absolute && !explicitPort) || (explicitPort && Number(explicitPort) < 1))
      return { ok: false, error: 'Include a numeric port for gRPC, for example localhost:50051.' };
    const port = parsed.port || explicitPort || (parsed.protocol === 'https:' ? '443' : '80');
    return {
      ok: true,
      handoff: {
        provenance,
        draft: {
          kind: 'grpc-target-draft',
          target: { kind: 'grpc-target', address: `${parsed.hostname}:${Number(port)}`, plaintext },
        },
      },
    };
  } catch {
    return {
      ok: false,
      error: 'Enter a valid HTTP(S) URL or host:port. Put IPv6 addresses in brackets.',
    };
  }
}
