import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepositoryFile(path: string) {
  return readFileSync(`${process.cwd()}/${path}`, 'utf8');
}

function parseHtml(path: string) {
  return new DOMParser().parseFromString(readRepositoryFile(path), 'text/html');
}

function pageText(document: Document) {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('Downloader public landing page', () => {
  it('ships a direct crawlable document with unique discovery metadata', () => {
    const downloader = parseHtml('docs/downloader/index.html');
    const homepage = parseHtml('docs/index.html');

    expect(downloader.title).toBe('ProtoPeek Downloader | Local aria2c Transfer Workbench');
    expect(downloader.title).not.toBe(homepage.title);
    expect(downloader.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://protopeek.shreyam1008.com.np/downloader/'
    );
    expect(downloader.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'ProtoPeek Downloader is an unreleased local transfer workbench in current source, using system or configured aria2c with queue controls and SHA-256 evidence.'
    );
    expect(downloader.querySelector('meta[name="description"]')?.getAttribute('content')).not.toBe(
      homepage.querySelector('meta[name="description"]')?.getAttribute('content')
    );
    expect(downloader.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(
      /^index,follow,/
    );
    expect(
      Array.from(downloader.querySelectorAll<HTMLAnchorElement>('a[href]')).every(
        (link) => !link.getAttribute('href')?.startsWith('#')
      )
    ).toBe(true);
  });

  it('contains one parseable JSON-LD block with the unreleased product boundary', () => {
    const downloader = parseHtml('docs/downloader/index.html');
    const structuredDataBlocks = Array.from(
      downloader.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
    );

    expect(structuredDataBlocks).toHaveLength(1);
    const structuredData = JSON.parse(structuredDataBlocks[0]?.textContent ?? '') as {
      '@context': string;
      '@type': string;
      name: string;
      url: string;
      softwareRequirements: string;
      screenshot: string[];
      additionalProperty: Array<{ name: string; value: string }>;
    };
    expect(structuredData).toEqual(
      expect.objectContaining({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'ProtoPeek Downloader',
        url: 'https://protopeek.shreyam1008.com.np/downloader/',
      })
    );
    expect(structuredData.softwareRequirements).toMatch(
      /system-installed or explicitly configured aria2c/i
    );
    expect(structuredData.screenshot).toEqual([
      'https://protopeek.shreyam1008.com.np/assets/protopeek-downloader-development.jpg',
      'https://protopeek.shreyam1008.com.np/assets/protopeek-downloader-development-mobile.jpg',
    ]);
    expect(structuredData.additionalProperty).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Release status',
          value: expect.stringMatching(/unreleased development feature/i),
        }),
        expect.objectContaining({
          name: 'Stable ProtoPeek release',
          value: expect.stringMatching(/v0\.4\.0; Downloader is not included/i),
        }),
      ])
    );
  });

  it('uses the manifest-backed real captures and publishes exact product truth', () => {
    const downloader = parseHtml('docs/downloader/index.html');
    const renderedText = pageText(downloader);
    const screenshots = Array.from(downloader.querySelectorAll<HTMLImageElement>('main img'));
    const screenshotManifest = JSON.parse(readRepositoryFile('guides/screenshots.json')) as {
      screenshots: Array<{ file: string; releaseStatus?: string }>;
    };
    const developmentScreenshotFiles = screenshotManifest.screenshots
      .filter((entry) => entry.releaseStatus === 'unreleased-development')
      .map((entry) => entry.file.replace('../web/site/public', ''));

    expect(screenshots.map((image) => image.getAttribute('src'))).toEqual(
      developmentScreenshotFiles
    );
    expect(renderedText).toMatch(/current development source, unreleased/i);
    expect(renderedText).toMatch(/v0\.4\.0 does not include Downloader/i);
    expect(renderedText).toMatch(/system-installed or explicitly configured aria2c/i);
    expect(renderedText).toMatch(/up to 32 independent jobs/i);
    expect(renderedText).toMatch(/pause or resume one job or the whole queue/i);
    expect(renderedText).toMatch(/bounded headers, and User-Agent/i);
    expect(renderedText).toContain('pp download [--output NAME] [--sha256 64_HEX] URL');
    expect(downloader.querySelector('a[href="/man/pp.1"]')).not.toBeNull();
    expect(downloader.querySelector('a[href="/man/protopeek.1"]')).not.toBeNull();
    expect(downloader.querySelector('a[href$="/blob/master/README.md"]')).not.toBeNull();
    expect(renderedText).toMatch(/GoBarryGo migration stays reversible/i);
    expect(renderedText).toMatch(/explicit bridge for GoBarryGo's one known local profile/i);
    expect(renderedText).toMatch(/keeps GoBarryGo files unchanged, and pauses imported jobs/i);
    expect(renderedText).toMatch(/public redirect and package retirement are not complete/i);
  });

  it('is discoverable from the public homepage, sitemap, and llms metadata', () => {
    const homepage = parseHtml('docs/index.html');
    const sitemap = readRepositoryFile('docs/sitemap.xml');
    const llms = readRepositoryFile('docs/llms.txt');

    expect(homepage.querySelectorAll('a[href="/downloader/"]').length).toBeGreaterThan(0);
    expect(sitemap).toContain('<loc>https://protopeek.shreyam1008.com.np/downloader/</loc>');
    expect(llms).toContain(
      'Downloader product page: https://protopeek.shreyam1008.com.np/downloader/'
    );
  });
});
