/** Discovery uses an authority; request paths and query values stay in the HTTP workbench. */
export function prepareDiscoveryTarget(
  value: string
): { ok: true; target: string } | { ok: false; error: string } {
  const target = value.trim();
  if (new TextEncoder().encode(target).length > 512) {
    return { ok: false, error: 'Use an address of at most 512 bytes.' };
  }
  if (!target) return { ok: true, target: '' };
  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(target);
    const parsed = new URL(absolute ? target : `http://${target}`);
    if (parsed.username || parsed.password) {
      return {
        ok: false,
        error: 'Remove credentials from the address. Add auth in the request workbench.',
      };
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      /\s/.test(target) ||
      (!absolute &&
        (target.endsWith(':') ||
          /[\\/?#@]/.test(target) ||
          parsed.pathname !== '/' ||
          parsed.search ||
          parsed.hash))
    ) {
      throw new Error('Invalid address');
    }
    return { ok: true, target: absolute ? parsed.origin : target };
  } catch {
    return {
      ok: false,
      error: 'Enter a host, host:port, or an HTTP(S) URL. Put IPv6 addresses in brackets.',
    };
  }
}
