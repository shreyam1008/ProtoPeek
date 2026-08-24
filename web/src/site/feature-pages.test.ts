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
