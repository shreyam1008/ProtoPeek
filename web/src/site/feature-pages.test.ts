import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepositoryFile(path: string) {
  return readFileSync(`${process.cwd()}/${path}`, 'utf8');
}

function parseHtml(path: string) {
  return new DOMParser().parseFromString(readRepositoryFile(path), 'text/html');
}

type PublicPage = {
  id: string;
  path: string;
  slug: string;
  kind: string;
  generator: string;
  group?: string;
  title: string;
  documentTitle: string;
  description: string;
  status?: { label: string; detail: string };
  sitemap?: { changefreq: string; priority: string };
};

const registry = JSON.parse(readRepositoryFile('web/src/site/public-pages.json')) as {
  lastModified: string;
  groups: Array<{ id: string; title: string }>;
  pages: PublicPage[];
};
const generatedPages = registry.pages.filter((page) => page.kind !== 'root');

describe('connected public feature guides', () => {
  it('keeps public labels and punctuation free of encoding corruption', () => {
    expect(JSON.stringify(registry)).not.toMatch(/\u00c2\u00b7|\u00e2\u20ac|\ufffd/);
    expect(registry.pages.find((page) => page.id === 'capnp-workbench')?.title).toContain(
      'Cap’n Proto'
    );
  });

  it('keeps route, title, and description metadata unique and search-sized', () => {
    expect(new Set(registry.pages.map((page) => page.path)).size).toBe(registry.pages.length);
    expect(new Set(registry.pages.map((page) => page.documentTitle)).size).toBe(
      registry.pages.length
    );
    expect(new Set(registry.pages.map((page) => page.description)).size).toBe(
      registry.pages.length
    );
    for (const page of registry.pages) {
      expect(page.documentTitle.length).toBeLessThanOrEqual(60);
      expect(page.description.length).toBeGreaterThanOrEqual(120);
      expect(page.description.length).toBeLessThanOrEqual(160);
    }
  });

  it.each(
    generatedPages
  )('$path publishes unique crawlable metadata and one clear page title', (page) => {
    const document = parseHtml(`docs/${page.slug}/index.html`);

    expect(document.title).toBe(page.documentTitle);
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      page.description
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `https://protopeek.shreyam1008.com.np${page.path}`
    );
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(
      /^index,follow,/
    );
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('.pp-breadcrumb')).not.toBeNull();
    expect(document.querySelector('a[href="/docs/"]')).not.toBeNull();
    expect(document.querySelector('a[href="/install/"]')).not.toBeNull();

    const jsonLd = JSON.parse(
      document.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}'
    ) as { '@type'?: string; breadcrumb?: { '@type'?: string } };
    expect(jsonLd['@type']).not.toMatch(/^(FAQPage|HowTo)$/);
    expect(jsonLd.breadcrumb?.['@type']).toBe('BreadcrumbList');

    if (page.status) {
      expect(document.body.textContent).toContain(page.status.label);
      expect(document.body.textContent).toContain(page.status.detail);
    }
  });

  it('derives the guide hub and internal links from the shared registry', () => {
    const hub = parseHtml('docs/docs/index.html');

    for (const group of registry.groups) {
      expect(hub.querySelector(`#${group.id}`)?.textContent).toContain(group.title);
    }
    for (const page of generatedPages.filter((candidate) => candidate.group)) {
      expect(hub.querySelector(`a[href="${page.path}"]`)).not.toBeNull();
    }
  });

  it('groups current guides by the v0.6 product contract without claiming planned providers', () => {
    const groupByPage = Object.fromEntries(registry.pages.map((page) => [page.id, page.group]));

    expect(groupByPage).toMatchObject({
      'grpc-workbench': 'protocols',
      'http-workbench': 'protocols',
      security: 'protocols',
      'network-workbench': 'network',
      'this-pc': 'network',
      extensions: 'publish',
      'cloudflare-tunnels': 'publish',
      downloader: 'files',
      settings: 'preferences',
    });
    expect(registry.groups.map((group) => group.id)).not.toContain('system');
    expect(registry.pages.map((page) => page.id)).not.toEqual(
      expect.arrayContaining(['private-access', 'tailscale', 'headscale', 'netbird'])
    );
  });

  it('documents the five real extensions with host setup and honest detection states', () => {
    const page = registry.pages.find((candidate) => candidate.id === 'extensions');
    expect(page?.status?.label).toBe('Current source');
    expect(page?.status?.detail).toContain('Stable v0.6.1 retains the earlier navigation');
    const guide = parseHtml('docs/extensions/index.html');
    const text = guide.body.textContent?.replace(/\s+/g, ' ') ?? '';
    for (const tool of ['Tailscale', 'Cloudflare Tunnel', 'Wireshark capture', 'Nmap', 'aria2']) {
      expect(text).toContain(tool);
    }
    for (const status of ['Detected', 'Included', 'Not found', 'Unavailable']) {
      expect(text).toContain(status);
    }
    expect(text).toContain('machine running ProtoPeek');
    expect(text).toContain('Detected does not mean ready');
    expect(text).toContain('Detection does not start a process');
    expect(text).toContain('does not require Wireshark, dumpcap or Npcap');
    expect(text).toContain('Headscale administration, NetBird, Tailscale Serve/Funnel');
    for (const href of [
      'https://tailscale.com/download',
      'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/',
      'https://www.wireshark.org/download.html',
      'https://npcap.com/#download',
      'https://nmap.org/download.html',
      'https://aria2.github.io/',
    ]) {
      expect(guide.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    for (const route of ['/tunnels', '/network/tailnet', '/network/nmap']) {
      expect(text).toContain(route);
    }
  });

  it('keeps wrapped Cloudflare guide bullets inside their list items', () => {
    const guide = parseHtml('docs/cloudflare-tunnels/index.html');
    const listItems = Array.from(guide.querySelectorAll('.pp-doc-prose li')).map((item) =>
      item.textContent?.replace(/\s+/g, ' ').trim()
    );

    expect(listItems).toContain(
      'which YAML candidate is selected as authoritative, why it won, and whether it is readable and valid, while keeping competing candidates visible;'
    );
    expect(listItems).toContain(
      'the current user’s .cloudflared/config.yml and .cloudflared/config.yaml on every supported platform;'
    );
  });

  it('derives fragment-free sitemap and llms discovery files from the same registry', () => {
    const publicSitemap = readRepositoryFile('web/site/public/sitemap.xml');
    const deployedSitemap = readRepositoryFile('docs/sitemap.xml');
    const publicLlms = readRepositoryFile('web/site/public/llms.txt');
    const deployedLlms = readRepositoryFile('docs/llms.txt');

    expect(deployedSitemap).toBe(publicSitemap);
    expect(deployedLlms).toBe(publicLlms);
    expect(publicSitemap).not.toContain('#');
    expect(publicSitemap).toContain(`<lastmod>${registry.lastModified}</lastmod>`);

    for (const page of registry.pages.filter((candidate) => candidate.sitemap)) {
      expect(publicSitemap).toContain(
        `<loc>https://protopeek.shreyam1008.com.np${page.path}</loc>`
      );
    }
    for (const page of generatedPages.filter((candidate) => candidate.group)) {
      expect(publicLlms).toContain(
        `${page.title}: https://protopeek.shreyam1008.com.np${page.path}`
      );
    }
  });
});
