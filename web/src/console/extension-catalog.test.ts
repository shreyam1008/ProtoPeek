import { describe, expect, it } from 'vitest';
import { createHandoffEnvelope } from './app/handoff-store';
import {
  catalogIds,
  extensionCatalog,
  extensionIds,
  parseExtensionObservation,
  parseExtensionSnapshot,
  setupPlatform,
} from './extension-catalog';
import { loadExtensionPack } from './extension-pack-loader';
import { prepareServiceEntry } from './service-entry';

const fixture = () => ({
  schemaVersion: 1,
  platform: 'linux',
  architecture: 'amd64',
  observedAt: '2026-09-28T00:00:00Z',
  extensions: extensionIds.map((id) => ({
    id,
    status: 'missing',
    source: 'none',
    path: '',
    message: 'Not found.',
    bundled: false,
    bundledBytes: 0,
  })),
});

describe('extension observations', () => {
  it('accepts one bounded observation for each supported integration', () => {
    expect(parseExtensionSnapshot(fixture()).extensions.map(({ id }) => id)).toEqual(extensionIds);
  });
  it.each([
    null,
    { ...fixture(), schemaVersion: 2 },
    { ...fixture(), observedAt: 'not a date' },
    { ...fixture(), extensions: [] },
    { ...fixture(), extensions: Array(5).fill(fixture().extensions[0]) },
    {
      ...fixture(),
      extensions: fixture().extensions.map((entry) => ({ ...entry, status: 'ready' })),
    },
    {
      ...fixture(),
      extensions: fixture().extensions.map((entry) => ({ ...entry, path: 'x'.repeat(4097) })),
    },
    {
      ...fixture(),
      extensions: fixture().extensions.map((entry) => ({ ...entry, bundledBytes: -1 })),
    },
  ])('rejects malformed or misleading observations', (value) => {
    expect(() => parseExtensionSnapshot(value)).toThrow('Could not read local tool status');
  });
  it('uses the host platform only when supported', () => {
    expect(setupPlatform('windows')).toBe('windows');
    expect(setupPlatform('darwin')).toBe('darwin');
    expect(setupPlatform('linux')).toBe('linux');
    expect(setupPlatform('freebsd')).toBeUndefined();
    expect(setupPlatform(undefined)).toBeUndefined();
  });
  it('lists twenty distinct, truthful capabilities with separately lazy official setup', async () => {
    expect(extensionCatalog.map(({ id }) => id)).toEqual(catalogIds);
    expect(new Set(catalogIds).size).toBe(20);
    expect(
      extensionCatalog
        .filter(({ capability }) => capability === 'native-workbench')
        .map(({ id }) => id)
    ).toEqual(extensionIds);
    expect(
      extensionCatalog.filter(({ group }) => group === 'Connect & publish').map(({ id }) => id)
    ).toEqual(['tailscale', 'cloudflared', 'netbird', 'caddy', 'ngrok', 'openssh']);
    for (const entry of extensionCatalog) {
      const pack = await loadExtensionPack(entry.id);
      expect(new URL(pack.download).protocol).toBe('https:');
      expect(new URL(pack.guide).protocol).toBe('https:');
      expect(Object.keys(pack.setup).sort()).toEqual(['darwin', 'linux', 'windows']);
      expect(pack.afterSetup).toBeTruthy();
      if (pack.endpoint) {
        const prepared = prepareServiceEntry(pack.endpoint.url, 'http');
        expect(prepared.ok).toBe(true);
        if (prepared.ok)
          expect(
            createHandoffEnvelope({
              ...prepared.handoff,
              provenance: {
                ...prepared.handoff.provenance,
                source: 'extension-library',
                path: '/extensions',
              },
            }).ok
          ).toBe(true);
        expect(new URL(pack.endpoint.url).hostname).toBe('127.0.0.1');
        expect(pack.endpoint.notice).toBeTruthy();
      }
      for (const command of pack.commands ?? []) {
        expect(command.text).not.toMatch(/(?:--address|GatewayPorts).*0\.0\.0\.0/);
        expect(command.text).not.toMatch(/authtoken|--insecure/);
      }
    }
    const caddy = await loadExtensionPack('caddy');
    expect((await loadExtensionPack('lm-studio')).client).toBe('lm-studio');
    expect(caddy.endpoint?.url).toContain('/reverse_proxy/upstreams');
    expect(caddy.endpoint?.url).not.toContain('/config/');
    const chatgpt = await loadExtensionPack('chatgpt');
    expect(chatgpt.client).toBeUndefined();
    expect(chatgpt.endpoint).toBeUndefined();
    expect(chatgpt.commands?.[0].text).not.toMatch(/127\.0\.0\.1|Bearer|access_token/);
    expect((await loadExtensionPack('lm-studio')).setup.darwin).toContain('Apple Silicon');
  });
  it('checks the connected hostname as well as the trust chain in the OpenSSL comparison', async () => {
    const openssl = await loadExtensionPack('openssl');
    const command = openssl.commands?.find(({ label }) => label.includes('verified TLS'));
    expect(command).toBeDefined();
    const args = command?.text.split(/\s+/) ?? [];
    const host = new URL(`https://${args[args.indexOf('-connect') + 1]}`).hostname;
    expect(args).toContain('-verify_return_error');
    expect(args[args.indexOf('-servername') + 1]).toBe(host);
    expect(args[args.indexOf('-verify_hostname') + 1]).toBe(host);
  });
  it('accepts exactly the requested version-two observation, without widening the legacy parser', () => {
    const one = {
      ...fixture(),
      schemaVersion: 2,
      extensions: [{ ...fixture().extensions[0], id: 'caddy' }],
    };
    expect(parseExtensionObservation(one, 'caddy').extensions[0].id).toBe('caddy');
    expect(() => parseExtensionSnapshot(one)).toThrow();
    expect(() => parseExtensionObservation(one, 'docker')).toThrow();
    expect(() =>
      parseExtensionObservation(
        { ...one, extensions: [...one.extensions, ...one.extensions] },
        'caddy'
      )
    ).toThrow();
    const external = {
      ...one,
      extensions: [{ ...one.extensions[0], id: 'chatgpt', status: 'external' }],
    };
    expect(parseExtensionObservation(external, 'chatgpt').extensions[0].status).toBe('external');
    expect(() =>
      parseExtensionObservation(
        { ...external, extensions: [{ ...external.extensions[0], path: '/fake' }] },
        'chatgpt'
      )
    ).toThrow();
    expect(() =>
      parseExtensionObservation(
        { ...one, extensions: [{ ...one.extensions[0], status: 'external' }] },
        'caddy'
      )
    ).toThrow();
  });
});
