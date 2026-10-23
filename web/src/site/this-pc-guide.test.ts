import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepositoryFile(path: string) {
  return readFileSync(`${process.cwd()}/${path}`, 'utf8').replaceAll('\r\n', '\n');
}

function parseHtml(path: string) {
  return new DOMParser().parseFromString(readRepositoryFile(path), 'text/html');
}

describe('This Device release guide', () => {
  it('documents the six-destination release and platform evidence boundaries', () => {
    const readme = readRepositoryFile('README.md');
    const guide = readRepositoryFile('guides/this-pc.md');
    const generator = readRepositoryFile('scripts/generate-site-docs.mjs');

    const product = JSON.parse(readRepositoryFile('product.json')) as {
      latestRelease: { version: string };
      releaseCandidate?: { version: string };
    };
    expect(readme).toContain(
      `v${product.releaseCandidate?.version ?? product.latestRelease.version}`
    );
    expect(readme).toContain('v0.6.1 has six permanent destinations');
    expect(readme).toContain('**This Device** under Network');
    expect(readme).not.toContain('seventh, route-lazy **This PC** workspace');
    expect(readme).not.toContain('eighth **Cloudflare Tunnel** workspace');
    expect(guide).toContain('available under Network in v0.6.1');
    expect(guide).toContain('**This Device** is ProtoPeek');
    expect(guide).toContain('canonical `/this-pc` route');
    expect(guide).toContain('`/api/this-pc/*` endpoints');
    expect(guide).toContain('A local listener is not proof that the port is reachable');
    expect(guide).toContain(
      'native Windows v1 backend reads the IP Helper owner-PID tables for TCP4, TCP6, UDP4, and UDP6'
    );
    expect(guide).toMatch(/macOS reports activity as\s+unsupported/);
    expect(guide).toContain('cooperative processing budget on Windows');
    expect(guide).toContain('reports the measured interval');
    expect(guide).toMatch(/two partial reads have no interface in\s+common/);
    expect(guide).toMatch(/evidence is no more than five\s+minutes old/);
    expect(guide).toContain('performs no DNS resolution, probe, connection');
    expect(guide).toMatch(
      /stable active-hop probing supports Linux UDP and Windows\s+IPv4\/IPv6 ICMP/
    );
    expect(guide).toContain(
      'current source adds unprivileged macOS ICMP with its own native acceptance gate'
    );
    expect(guide).toContain('Stable v0.6.1 reports macOS sampling as unsupported');
    expect(guide).toMatch(/current source reads native\s+`NET_RT_IFLIST2` counters/);
    expect(guide).toContain(
      'socket activity and process ownership remain outside the implemented macOS contract'
    );
    expect(guide).not.toContain('macOS and Windows report listeners');
    expect(guide).not.toContain('for the planned native Windows backend');
    expect(guide).toContain('single-flow HTTPS connection quality to Cloudflare edge');
    expect(generator).toContain(
      'v0.6.1 is the current stable release with Home, Inspect, Network, Publish, Files and Settings'
    );
    expect(generator).not.toContain('Current source adds a seventh route-lazy area, This PC');
    expect(generator).not.toContain('Current source also adds an eighth route-lazy area');
  });

  it('keeps the source registry and crawlable compatibility path aligned', () => {
    const registry = JSON.parse(readRepositoryFile('web/src/site/public-pages.json')) as {
      pages: Array<{
        id: string;
        path: string;
        title: string;
        documentTitle: string;
        description?: string;
        lastModified?: string;
        keywords?: string[];
      }>;
    };
    const sourcePage = registry.pages.find((candidate) => candidate.id === 'this-pc');
    const page = parseHtml('docs/this-pc/index.html');
    const docsHub = parseHtml('docs/docs/index.html');
    const sitemap = readRepositoryFile('docs/sitemap.xml');

    expect(sourcePage).toMatchObject({
      path: '/this-pc/',
      title: 'This Device evidence',
      documentTitle: 'This Device: Ports, Public IP & Speed Evidence | ProtoPeek',
      description:
        'Inspect bounded Linux and Windows sockets, process owners and interface traffic, plus explicit public-IP/BGP and Cloudflare quality checks in ProtoPeek.',
    });
    const lastModified = sourcePage?.lastModified;
    expect(lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const article = JSON.parse(
      page.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}'
    ) as { dateModified?: string };
    expect(article.dateModified).toBe(lastModified);
    expect(sourcePage?.keywords).toEqual(
      expect.arrayContaining([
        'Windows socket ownership',
        'Windows TCP UDP ports',
        'Linux socket inspection',
        'local interface counters',
      ])
    );
    expect(page.title).toBe('This Device: Ports, Public IP & Speed Evidence | ProtoPeek');
    expect(page.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://protopeek.shreyam1008.com.np/this-pc/'
    );
    expect(page.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(
      /^index,follow,/
    );
    expect(page.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
    expect(docsHub.querySelector('a[href="/this-pc/"]')?.textContent).toContain(
      'This Device evidence'
    );
    const sitemapPage = Array.from(
      new DOMParser().parseFromString(sitemap, 'application/xml').querySelectorAll('url')
    ).find(
      (entry) =>
        entry.querySelector('loc')?.textContent === 'https://protopeek.shreyam1008.com.np/this-pc/'
    );
    expect(sitemapPage?.querySelector('lastmod')?.textContent).toBe(lastModified);
  });

  it('pins and redistributes the direct benchmark dependency with its licence notice', () => {
    const packageMetadata = JSON.parse(readRepositoryFile('package.json')) as {
      dependencies: Record<string, string>;
    };
    const notice = readRepositoryFile('THIRD_PARTY_NOTICES.md');
    const stableRelease = readRepositoryFile('.goreleaser.yml');
    const edgeRelease = readRepositoryFile('.goreleaser.edge.yml');

    expect(packageMetadata.dependencies['@cloudflare/speedtest']).toBe('1.12.1');
    expect(notice).toContain('`@cloudflare/speedtest` 1.12.1');
    expect(notice).toContain('Copyright (c) 2023 Cloudflare');
    expect(notice).toContain('MIT License');
    expect(stableRelease).toContain('- THIRD_PARTY_NOTICES.md');
    expect(edgeRelease).toContain('- THIRD_PARTY_NOTICES.md');
  });
});
