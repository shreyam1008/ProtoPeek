import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readRepositoryBytes(path: string) {
  return readFileSync(resolve(repositoryRoot, path));
}

function readRepositoryFile(path: string) {
  return readRepositoryBytes(path).toString('utf8').replaceAll('\r\n', '\n');
}

const product = JSON.parse(readRepositoryFile('product.json')) as {
  latestRelease: { version: string; status: string; url: string };
  releaseCandidate?: { version: string; status: string };
  distributions: Array<{
    channel: string;
    status: string;
    url: string;
    version?: string;
    verifiedAt?: string;
  }>;
};
const stableVersion = product.latestRelease.version;
const packagedVersion = product.releaseCandidate?.version ?? stableVersion;

describe('release metadata', () => {
  it('keeps the stable release and independently promoted package versions explicit', () => {
    const packageVersions = Object.fromEntries(
      product.distributions.map((channel) => [channel.channel, channel.version])
    );

    expect(product.latestRelease).toEqual({
      version: stableVersion,
      status: 'published',
      url: `https://github.com/shreyam1008/ProtoPeek/releases/tag/v${stableVersion}`,
    });
    expect(stableVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageVersions['GitHub Releases']).toBe(stableVersion);
    for (const name of ['Homebrew Tap', 'Scoop Bucket']) {
      const channel = product.distributions.find((item) => item.channel === name);
      expect(channel?.status).toBe('live');
      expect(channel?.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(channel?.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(channel?.url).toMatch(/^https:\/\/github.com\/shreyam1008\//);
    }
    if (product.releaseCandidate) {
      expect(product.releaseCandidate.status).toBe('prepared');
      expect(product.releaseCandidate.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(product.releaseCandidate.version).not.toBe(stableVersion);
    }
    const readme = readRepositoryFile('README.md');
    expect(readme).toContain(`v${packagedVersion}`);
    if (packagedVersion !== stableVersion) {
      expect(readme).not.toContain(`Latest stable: v${stableVersion}`);
    }
    const stable = readRepositoryFile('.goreleaser.yml');
    expect(stable).toContain('use_existing_draft: true');
    expect(stable).toContain('replace_existing_artifacts: true');
    const checksumSection = stable.split('\nchecksum:\n')[1]?.split('\nsboms:')[0];
    for (const file of [
      './install.sh',
      './install.ps1',
      './.local/aria2-1.37.0-companion-sources.tar.gz',
    ]) {
      expect(checksumSection).toContain(`glob: ${file}`);
    }
  });

  it('publishes branch builds only to Nightly and keeps stable promotion explicit', () => {
    const nightly = readRepositoryFile('.github/workflows/release-nightly.yml');
    const edge = readRepositoryFile('.github/workflows/release-edge.yml');
    const stable = readRepositoryFile('.github/workflows/release.yml');
    const packaging = readRepositoryFile('.goreleaser.edge.yml');
    expect(nightly).toContain('    branches:\n      - main\n      - master');
    expect(nightly).toContain('GORELEASER_CURRENT_TAG: v0.0.0-nightly');
    expect(nightly).toContain('subject-checksums: ./dist/checksums.txt');
    expect(nightly).not.toContain('config .goreleaser.yml');
    expect(edge).not.toContain('  push:');
    expect(stable).toContain("      - '!v*-*'");
    expect(packaging).toContain('prerelease: true');
    expect(packaging).toContain('make_latest: false');
    expect(packaging).not.toMatch(/^(brews|scoops|dockers):/m);
    expect(readRepositoryFile('.github/workflows/snap.yml')).not.toContain('  push:');
    expect(stable).toContain('unsquashfs -d "$snap_root"');
    const snap = readRepositoryFile('snap/snapcraft.yaml');
    for (const license of [
      'go-capnp-MIT.txt',
      'zeropool-APACHE-2.0.txt',
      'quic-go-MIT.txt',
      'qpack-MIT.txt',
    ]) {
      expect(snap).toContain(license);
      expect(stable).toContain(license);
    }
  });

  it('aligns public discovery metadata and packaged manual headers', () => {
    const siteIndex = readRepositoryFile('web/site/index.html');
    const llms = readRepositoryFile('web/site/public/llms.txt');
    const sitemap = readRepositoryFile('web/site/public/sitemap.xml');
    const manifest = JSON.parse(readRepositoryFile('web/site/public/site.webmanifest')) as {
      name: string;
      description: string;
      theme_color: string;
    };

    const registry = JSON.parse(readRepositoryFile('web/src/site/public-pages.json')) as {
      pages: Array<{ id: string; documentTitle: string }>;
    };
    const document = new DOMParser().parseFromString(siteIndex, 'text/html');
    expect(document.title).toBe(registry.pages.find((page) => page.id === 'home')?.documentTitle);
    expect(document.title).toContain('gRPC, HTTP');
    expect(siteIndex).toContain(`"softwareVersion": "${stableVersion}"`);
    expect(siteIndex).toContain(`/releases/tag/v${stableVersion}`);
    expect(siteIndex).toContain('six areas: Home, Inspect, Network, Publish, Files, and Settings');
    expect(siteIndex).toContain(
      '<meta property="og:image" content="https://protopeek.shreyam1008.com.np/protopeek-social-v3.png" />'
    );
    expect(siteIndex).toContain('<meta property="og:image:width" content="1200" />');
    expect(siteIndex).toContain('<meta property="og:image:height" content="630" />');
    expect(manifest.theme_color).toBe('#0b5cff');
    expect(llms).toContain(`v${stableVersion} is the current stable release`);
    expect(llms).toContain('Homebrew and Scoop manifests identify their package versions');
    expect(llms).toContain('Windows x64 includes pinned aria2 1.37.0');
    expect(llms).toContain('Headscale HTTPS login-server flow and native NetBird');
    expect(llms).toContain(
      'Native macOS socket/process ownership and foreground publishing remain unavailable'
    );
    expect(llms).toContain(
      'Downloader product page: https://protopeek.shreyam1008.com.np/downloader/'
    );
    expect(llms).toContain('explicit website/TLS/header/path evidence');
    expect(sitemap).toContain('<lastmod>2026-09-07</lastmod>');
    expect(sitemap).toContain('<loc>https://protopeek.shreyam1008.com.np/downloader/</loc>');
    for (const path of [
      '/install/',
      '/grpc-workbench/',
      '/http-workbench/',
      '/security/',
      '/settings/',
    ]) {
      expect(sitemap).toContain(`<loc>https://protopeek.shreyam1008.com.np${path}</loc>`);
    }
    expect(manifest).toEqual(
      expect.objectContaining({
        name: 'ProtoPeek — Local Systems Workbench',
        description: expect.stringContaining('bounded network and security evidence'),
      })
    );
    expect(manifest.description).not.toContain('Six-area');

    const protopeekMan = readRepositoryFile('web/site/public/man/protopeek.1');
    const ppMan = readRepositoryFile('web/site/public/man/pp.1');
    // Match the stable-tag guard's exact fourth quoted field, including patch version.
    expect(protopeekMan.split('\n')[0]?.split('"')[3]).toBe(`ProtoPeek ${packagedVersion}`);
    expect(ppMan.split('\n')[0]?.split('"')[3]).toBe(`ProtoPeek ${packagedVersion}`);
    expect(protopeekMan).toContain('.B protopeek download');
    expect(protopeekMan).toContain('subcommand ships in ProtoPeek v0.5.0');
    expect(protopeekMan).toContain('Windows x64 includes pinned aria2 1.37.0');
    expect(protopeekMan).toContain('does not attach to an\nalready-running ProtoPeek process');
    expect(protopeekMan).toContain('.B protopeek migrate-gobarry');
    expect(protopeekMan).toContain('observational preview');
    expect(ppMan).toContain('.B pp download');
    expect(ppMan).toContain('.B pp migrate-gobarry');
    expect(ppMan).toContain('Windows x64 also includes bundled aria2');
  });

  it('keeps implemented source capabilities out of stale planned claims and labels legacy Edge', () => {
    const registry = JSON.parse(readRepositoryFile('web/src/site/public-pages.json')) as {
      currentCapabilities: Array<{ id: string; label: string; summary: string; guide: string }>;
      pages: Array<{ id: string; path: string; sourcePath?: string; lastModified?: string }>;
    };
    const llms = readRepositoryFile('web/site/public/llms.txt');
    const readme = readRepositoryFile('README.md');
    for (const capability of registry.currentCapabilities) {
      const guide = registry.pages.find((page) => page.id === capability.guide);
      expect(guide?.sourcePath).toBeTruthy();
      expect(llms).toContain(`${capability.label}: ${capability.summary}`);
      expect(llms).toContain(`Guide: https://protopeek.shreyam1008.com.np${guide?.path}`);
      expect(readme).toContain(guide?.sourcePath);
    }
    expect(llms).not.toContain('Config writes and account mutation remain unavailable');
    expect(llms).not.toContain('returned-capability RPC workflows remain planned');
    expect(readme).toContain(
      'configured/system `aria2c` in v0.5.0; Windows x64 fallback in v0.6.1'
    );
    expect(readme).toContain('<a id="install"></a>');
    expect(readme).toContain('<a id="usage"></a>');
    expect(readme).toContain('clearly labelled integration levels');
    expect(readme).not.toMatch(/\b\d+ UI tests\b/);
    expect(readme).not.toMatch(/nightly[^\n]{0,80}\b[0-9a-f]{7,40}\b/i);
    const source = new DOMParser().parseFromString(
      readRepositoryFile('web/site/index.html'),
      'text/html'
    );
    for (const selector of [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]) {
      const description = source.querySelector(selector)?.getAttribute('content') ?? '';
      if (/\bedge\b/i.test(description)) expect(description).toMatch(/\blegacy\b/i);
    }
    const graph = JSON.parse(
      source.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}'
    ) as { '@graph': Array<Record<string, unknown>> };
    expect(graph['@graph'].find((item) => item['@type'] === 'WebSite')?.dateModified).toBe(
      registry.pages.find((page) => page.id === 'home')?.lastModified
    );
    expect(graph['@graph'].some((item) => 'review' in item || 'aggregateRating' in item)).toBe(
      false
    );
  });

  it('keeps consolidation and website-analysis guides split into current and planned work', () => {
    const consolidation = readRepositoryFile('guides/gobarrygo-consolidation.md');
    const security = readRepositoryFile('guides/website-analysis-security.md');

    expect(consolidation).toContain('No public redirect or repository\narchive has happened');
    expect(consolidation).toContain('Homebrew and Scoop channels install v0.6.1');
    expect(consolidation).toContain('GoBarryGo PR `#3` merged as `144c725c`');
    expect(consolidation).toContain('The permanent redirect remains disabled');
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

  it('keeps historical release captures separate from verified unreleased source PNGs', () => {
    const manifest = JSON.parse(readRepositoryFile('guides/screenshots.json')) as {
      screenshots: Array<{
        file: string;
        alt: string;
        capturedVersion: string;
        releaseStatus?: string;
        width?: number;
        height?: number;
        sha256?: string;
        workflow: string;
      }>;
    };

    expect(manifest.screenshots).toHaveLength(9);
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

    const sourceCaptures = manifest.screenshots.filter(
      (screenshot) => screenshot.releaseStatus === 'unreleased-source'
    );
    expect(sourceCaptures.map((screenshot) => screenshot.file)).toEqual([
      '../web/site/public/assets/protopeek-source-home-20261023.png',
      '../web/site/public/assets/protopeek-source-extensions-20261023.png',
    ]);
    for (const capture of sourceCaptures) {
      expect(capture.capturedVersion).toContain('unreleased current-source preview');
      expect(capture.alt).toMatch(/^Current-source ProtoPeek (Home|Extensions)\b/);
      expect(capture.workflow).toContain('This is UI evidence, not');
      expect(capture.sha256).toMatch(/^[a-f0-9]{64}$/);
      const png = readRepositoryBytes(`guides/${capture.file}`);
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.subarray(12, 16).toString()).toBe('IHDR');
      expect(png.readUInt32BE(16)).toBe(capture.width);
      expect(png.readUInt32BE(20)).toBe(capture.height);
      expect(createHash('sha256').update(png).digest('hex')).toBe(capture.sha256);
    }
  });
});
