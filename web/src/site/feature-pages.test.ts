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

  it('lets keyboard readers scroll named guide tables without changing their table semantics', () => {
    const guide = parseHtml('docs/extensions/index.html');
    const tables = Array.from(guide.querySelectorAll('.pp-doc-prose table'));
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.getAttribute('tabindex')).toBe('0');
      expect(table.hasAttribute('role')).toBe(false);
      const headingId = table.getAttribute('aria-labelledby');
      expect(headingId).toBeTruthy();
      expect(guide.getElementById(headingId ?? '')?.textContent?.trim()).toBeTruthy();
      expect(table.querySelectorAll('th').length).toBeGreaterThan(0);
    }
    expect(tables[0]?.getAttribute('aria-labelledby')).toBe('six-native-workbenches');
  });

  it('groups the protocol family and existing domains without inventing provider pages', () => {
    const groupByPage = Object.fromEntries(registry.pages.map((page) => [page.id, page.group]));

    expect(groupByPage).toMatchObject({
      'grpc-workbench': 'protocols',
      'http-workbench': 'protocols',
      'event-streams': 'protocols',
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

  it('documents the 20-entry library without treating every entry as a native adapter', () => {
    const page = registry.pages.find((candidate) => candidate.id === 'extensions');
    expect(page?.status?.label).toBe('Current source');
    expect(page?.status?.detail).toContain('Stable v0.6.1 retains the earlier navigation');
    const guide = parseHtml('docs/extensions/index.html');
    const text = guide.body.textContent?.replace(/\s+/g, ' ') ?? '';
    const catalog = JSON.parse(
      readRepositoryFile('web/src/console/extension-manifest.json')
    ) as Array<{ name: string; capability: string }>;
    expect(catalog).toHaveLength(20);
    expect(catalog.filter((entry) => entry.capability === 'native-workbench')).toHaveLength(6);
    for (const entry of catalog) {
      expect(text).toContain(entry.name);
    }
    for (const status of ['Detected', 'Included', 'Not found', 'Unavailable']) {
      expect(text).toContain(status);
    }
    expect(text).toContain('machine running ProtoPeek');
    expect(text).toContain('Detected does not mean ready');
    expect(text).toContain('Detection does not start a process');
    expect(text).toContain('does not require Wireshark, dumpcap or Npcap');
    for (const level of [
      'Native workbench',
      'Command guide',
      'MCP setup',
      'Endpoint guide',
      'External link',
    ])
      expect(text).toContain(level);
    expect(text).toContain('Opening the catalog does not inspect tools or load every detail pack');
    expect(text).toContain('Pins and manual setup-platform choices');
    expect(text).toContain('only catalog and platform IDs in this browser');
    expect(text).toContain('Check this host');
    expect(text).toContain('Never publish the Caddy admin port');
    expect(text).toContain('existing Windows x64 aria2 bundle is the explicit exception');
    expect(text).toContain('Headscale administration, integrated sign-in/elevation');
    expect(text).not.toContain(
      'NetBird, Tailscale Serve/Funnel, integrated sign-in and automatic tool installation remain outside'
    );
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

  it('places Event streams between gRPC and Capnp with its real finite-session contract', () => {
    const protocols = registry.pages.filter((page) => page.group === 'protocols');
    expect(protocols.slice(0, 5).map((page) => page.id)).toEqual([
      'http-workbench',
      'grpc-workbench',
      'event-streams',
      'capnp-workbench',
      'security',
    ]);
    const event = parseHtml('docs/event-streams/index.html');
    const text = event.body.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('500 received messages or 2 MiB');
    expect(text).toContain('64 KiB per-message limit');
    expect(text).toContain('latest 200 timeline rows');
    expect(text).toContain('does not reconnect automatically');
    expect(text).toContain('browser observation times');
    const related = event.querySelector('nav[aria-label="Related ProtoPeek guides"]');
    expect(
      Array.from(related?.querySelectorAll('a') ?? []).map((link) => link.getAttribute('href'))
    ).toEqual(['/grpc-workbench/', '/capnp-workbench/']);
    expect(
      parseHtml('docs/grpc-workbench/index.html').querySelector(
        'nav[aria-label="Related ProtoPeek guides"] a[href="/event-streams/"]'
      )
    ).not.toBeNull();
    expect(
      parseHtml('docs/capnp-workbench/index.html').querySelector(
        'nav[aria-label="Related ProtoPeek guides"] a[href="/event-streams/"]'
      )
    ).not.toBeNull();
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
