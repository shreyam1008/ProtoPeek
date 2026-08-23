import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepositoryFile(path: string) {
  return readFileSync(`${process.cwd()}/${path}`, 'utf8');
}

describe('release metadata', () => {
  it('keeps the stable release and independently promoted package versions explicit', () => {
    const product = JSON.parse(readRepositoryFile('product.json')) as {
      latestRelease: { version: string; status: string; url: string };
      distributions: Array<{ channel: string; version?: string }>;
    };
    const packageVersions = Object.fromEntries(
      product.distributions.map((channel) => [channel.channel, channel.version])
    );

    expect(product.latestRelease).toEqual({
      version: '0.5.0',
      status: 'published',
      url: 'https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.5.0',
    });
    expect(packageVersions['GitHub Releases']).toBe('0.5.0');
    expect(packageVersions['Homebrew Tap']).toBe('0.4.0');
    expect(packageVersions['Scoop Bucket']).toBe('0.4.0');
  });

  it('aligns public discovery metadata and packaged manual headers', () => {
    const siteIndex = readRepositoryFile('web/site/index.html');
    const llms = readRepositoryFile('web/site/public/llms.txt');
    const sitemap = readRepositoryFile('web/site/public/sitemap.xml');
    const manifest = JSON.parse(readRepositoryFile('web/site/public/site.webmanifest')) as {
      name: string;
      description: string;
    };

    expect(siteIndex).toContain('<title>ProtoPeek | Local Systems Workbench</title>');
    expect(siteIndex).toContain('"softwareVersion": "0.5.0"');
    expect(siteIndex).toContain('/releases/tag/v0.5.0');
    expect(siteIndex).toContain(
      'six areas: Overview, Protocols, Network, Downloader, Security, and Settings'
    );
    expect(llms).toContain('v0.5.0 is the current stable release');
    expect(llms).toContain('Homebrew and Scoop channels remain at v0.4.0');
    expect(llms).toContain('ProtoPeek does not bundle aria2');
    expect(llms).toContain(
      'Downloader product page: https://protopeek.shreyam1008.com.np/downloader/'
    );
    expect(llms).toContain('exactly one credential-free, non-following `HEAD` request');
    expect(sitemap).toContain('<lastmod>2026-08-24</lastmod>');
    expect(sitemap).toContain('<loc>https://protopeek.shreyam1008.com.np/downloader/</loc>');
    expect(sitemap).not.toContain('/security/');
    expect(manifest).toEqual(
      expect.objectContaining({
        name: 'ProtoPeek — Local Systems Workbench',
        description: expect.stringContaining('bounded network and security evidence'),
      })
    );

    const protopeekMan = readRepositoryFile('web/site/public/man/protopeek.1');
    const ppMan = readRepositoryFile('web/site/public/man/pp.1');
    expect(protopeekMan).toMatch(/^\.TH PROTOPEEK 1 "August 2026" "ProtoPeek 0\.5\.0"/);
    expect(ppMan).toMatch(/^\.TH PP 1 "August 2026" "ProtoPeek 0\.5\.0"/);
    expect(protopeekMan).toContain('.B protopeek download');
    expect(protopeekMan).toContain('subcommand ships in ProtoPeek v0.5.0');
    expect(protopeekMan).toContain('Homebrew and Scoop remain at v0.4.0');
    expect(protopeekMan).toContain('does not attach to an\nalready-running ProtoPeek process');
    expect(protopeekMan).toContain('.B protopeek migrate-gobarry');
    expect(protopeekMan).toContain('observational preview');
    expect(ppMan).toContain('.B pp download');
    expect(ppMan).toContain('.B pp migrate-gobarry');
    expect(ppMan).toContain('ProtoPeek v0.5.0 ships');
  });

  it('keeps consolidation and website-analysis guides split into current and planned work', () => {
    const consolidation = readRepositoryFile('guides/gobarrygo-consolidation.md');
    const security = readRepositoryFile('guides/website-analysis-security.md');

    expect(consolidation).toContain(
      'No public redirect, package\npromotion, or repository archive has'
    );
    expect(consolidation).toContain('pp download [--output NAME] [--sha256 64_HEX] URL');
    expect(consolidation).toContain('`download --ui`, `downloads list`, job-action subcommands');
    expect(consolidation).toContain('are ideas only. They\nare not implemented');
    expect(consolidation).toContain('canonical browser route is `/downloader`');
    expect(consolidation).toContain('## Implemented GoBarryGo state bridge');
    expect(consolidation).toContain(
      'pp migrate-gobarry                              # observational preview'
    );
    expect(consolidation).toContain('private mode-0600 state');
    expect(consolidation).toContain(
      'Rollback\nis allowed only while current ProtoPeek transfer state still matches'
    );

    expect(security).toContain('at most two concurrent client requests');
    expect(security).toContain('does not return per-candidate observation dates');
    expect(security).toContain('exactly one credential-free `HEAD` request');
    expect(security).toContain('redirects are returned as bounded evidence but never followed');
    expect(security).toContain('## Planned, not shipped');
    expect(security).toContain('multi-request website plans');
    expect(security).toMatch(/does\s+not emit a security score/);
  });

  it('labels real Downloader captures as v0.5.0 release-source evidence', () => {
    const manifest = JSON.parse(readRepositoryFile('guides/screenshots.json')) as {
      screenshots: Array<{
        file: string;
        capturedVersion: string;
        releaseStatus?: string;
        workflow: string;
      }>;
    };

    expect(manifest.screenshots).toHaveLength(5);
    const releaseCaptures = manifest.screenshots.filter(
      (screenshot) => screenshot.releaseStatus === 'released-v0.5.0'
    );
    expect(releaseCaptures.map((screenshot) => screenshot.file)).toEqual([
      '../web/site/public/assets/protopeek-downloader-development.jpg',
      '../web/site/public/assets/protopeek-downloader-development-mobile.jpg',
    ]);
    expect(
      releaseCaptures.every(
        (screenshot) =>
          screenshot.capturedVersion === 'v0.5.0 release source' &&
          /Real Chrome capture/.test(screenshot.workflow) &&
          /promoted into v0\.5\.0/.test(screenshot.workflow)
      )
    ).toBe(true);
  });
});
