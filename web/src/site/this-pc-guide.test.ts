import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepositoryFile(path: string) {
  return readFileSync(`${process.cwd()}/${path}`, 'utf8').replaceAll('\r\n', '\n');
}

function parseHtml(path: string) {
  return new DOMParser().parseFromString(readRepositoryFile(path), 'text/html');
}

describe('This Device current-source guide', () => {
  it('keeps stable v0.5.0 history separate from the six-destination current source', () => {
    const readme = readRepositoryFile('README.md');
    const guide = readRepositoryFile('guides/this-pc.md');
    const generator = readRepositoryFile('scripts/generate-site-docs.mjs');

    expect(readme).toContain('shipped unified shell has exactly six primary areas');
    expect(readme).toContain('the v0.6 workbench has exactly six permanent destinations');
    expect(readme).toContain('**This Device** workspace');
    expect(readme).not.toContain('seventh, route-lazy **This PC** workspace');
    expect(readme).not.toContain('eighth **Cloudflare Tunnel** workspace');
    expect(guide).toContain('not part of the published v0.5.0 release');
    expect(guide).toContain('**This Device** is ProtoPeek');
    expect(guide).toContain('canonical `/this-pc` route');
    expect(guide).toContain('`/api/this-pc/*` endpoints');
    expect(guide).toContain('A local listener is not proof that the port is reachable');
    expect(guide).toContain('single-flow HTTPS connection quality to Cloudflare edge');
    expect(generator).toContain('Current source implements exactly six permanent destinations');
    expect(generator).not.toContain('Current source adds a seventh route-lazy area, This PC');
    expect(generator).not.toContain('Current source also adds an eighth route-lazy area');
  });

  it('keeps the source registry and crawlable compatibility path aligned', () => {
    const registry = JSON.parse(readRepositoryFile('web/src/site/public-pages.json')) as {
      pages: Array<{ id: string; path: string; title: string; documentTitle: string }>;
    };
    const sourcePage = registry.pages.find((candidate) => candidate.id === 'this-pc');
    const page = parseHtml('docs/this-pc/index.html');
    const docsHub = parseHtml('docs/docs/index.html');
    const sitemap = readRepositoryFile('docs/sitemap.xml');

    expect(sourcePage).toMatchObject({
      path: '/this-pc/',
      title: 'This Device evidence',
      documentTitle: 'This Device: Ports, Public IP & Speed Evidence | ProtoPeek',
    });
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
    expect(sitemap).toContain('<loc>https://protopeek.shreyam1008.com.np/this-pc/</loc>');
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
