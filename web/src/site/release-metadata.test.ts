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
      version: '0.3.2',
      status: 'published',
      url: 'https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.3.2',
    });
    expect(packageVersions['GitHub Releases']).toBe('0.3.2');
    expect(packageVersions['Homebrew Tap']).toBe('0.3.2');
    expect(packageVersions['Scoop Bucket']).toBe('0.3.2');
  });

  it('aligns public discovery metadata and packaged manual headers', () => {
    const siteIndex = readRepositoryFile('web/site/index.html');
    const llms = readRepositoryFile('web/site/public/llms.txt');

    expect(siteIndex).toContain('"softwareVersion": "0.3.2"');
    expect(siteIndex).toContain('/releases/tag/v0.3.2');
    expect(llms).toContain('v0.3.2 is the current public stable release');
    expect(llms).toContain('Homebrew and Scoop definitions all install checksum-pinned v0.3.2');
    expect(readRepositoryFile('web/site/public/man/protopeek.1')).toMatch(
      /^\.TH PROTOPEEK 1 "August 2026" "ProtoPeek 0\.3\.2"/
    );
    expect(readRepositoryFile('web/site/public/man/pp.1')).toMatch(
      /^\.TH PP 1 "August 2026" "ProtoPeek 0\.3\.2"/
    );
  });
});
