import { describe, expect, it } from 'vitest';
import manifest from '../../../internal/media/tools.json';
import { matchingMediaPacks } from './MediaPacks';

describe('media companion discovery', () => {
  it('searches each companion by name and practical use', () => {
    expect(matchingMediaPacks('').map((item) => item.id)).toEqual([
      'yt-dlp',
      'gallery-dl',
      'deno',
      'ffmpeg',
    ]);
    expect(matchingMediaPacks('gallery album').map((item) => item.id)).toEqual(['gallery-dl']);
    expect(matchingMediaPacks('javascript runtime').map((item) => item.id)).toEqual(['deno']);
    expect(matchingMediaPacks('merge audio').map((item) => item.id)).toEqual(['ffmpeg']);
    expect(matchingMediaPacks('not-present')).toEqual([]);
  });
  it('displays the platforms with a pinned package for each tool', () => {
    const systems: Record<string, string> = { windows: 'Windows', linux: 'Linux', darwin: 'macOS' };
    for (const pack of matchingMediaPacks('')) {
      const platforms = manifest
        .filter((asset) => asset.engine === pack.id)
        .map((asset) => {
          const [os, arch] = asset.platform.split('/');
          return `${systems[os]} ${arch === 'amd64' ? 'x64' : arch.toUpperCase()}`;
        });
      expect(pack.platforms.split(', ')).toEqual(platforms);
    }
  });
});
