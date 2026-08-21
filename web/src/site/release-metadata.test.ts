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
      version: '0.4.0',
      status: 'published',
      url: 'https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.4.0',
    });
    expect(packageVersions['GitHub Releases']).toBe('0.4.0');
    expect(packageVersions['Homebrew Tap']).toBe('0.4.0');
    expect(packageVersions['Scoop Bucket']).toBe('0.4.0');
  });

  it('aligns public discovery metadata and packaged manual headers', () => {
    const siteIndex = readRepositoryFile('web/site/index.html');
    const llms = readRepositoryFile('web/site/public/llms.txt');

    expect(siteIndex).toContain('"softwareVersion": "0.4.0"');
    expect(siteIndex).toContain('/releases/tag/v0.4.0');
    expect(llms).toContain('v0.4.0 is the current stable release');
    expect(llms).toContain('owned Homebrew/Scoop channels publish its independently tested');
    expect(readRepositoryFile('web/site/public/man/protopeek.1')).toMatch(
      /^\.TH PROTOPEEK 1 "August 2026" "ProtoPeek 0\.4\.0"/
    );
    expect(readRepositoryFile('web/site/public/man/pp.1')).toMatch(
      /^\.TH PP 1 "August 2026" "ProtoPeek 0\.4\.0"/
    );
  });
});
