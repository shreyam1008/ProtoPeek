import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  type BundleAsset,
  type BundleBudget,
  evaluateBundleBudgets,
  measureBundleDirectory,
  runBundleBudgetCheck,
} from '../../../scripts/bundle-budget';

const budgets: BundleBudget[] = [
  {
    label: 'entry',
    pattern: /^index-.+\.js$/,
    maxRawBytes: 100,
    maxGzipBytes: 50,
  },
];

describe('bundle budget contract', () => {
  it('accepts an exact-boundary asset', () => {
    const assets: BundleAsset[] = [{ name: 'index-hash.js', rawBytes: 100, gzipBytes: 50 }];

    expect(evaluateBundleBudgets(assets, budgets)).toEqual([]);
  });

  it('rejects missing and ambiguous single-chunk matches', () => {
    expect(evaluateBundleBudgets([], budgets)).toEqual(['entry: no matching asset']);

    const duplicated: BundleAsset[] = [
      { name: 'index-first.js', rawBytes: 80, gzipBytes: 40 },
      { name: 'index-second.js', rawBytes: 90, gzipBytes: 45 },
    ];
    expect(evaluateBundleBudgets(duplicated, budgets)).toEqual([
      'entry: expected one matching asset, found 2',
    ]);
  });

  it('reports raw and gzip overruns without rounding away bytes', () => {
    const assets: BundleAsset[] = [{ name: 'index-hash.js', rawBytes: 101, gzipBytes: 51 }];

    expect(evaluateBundleBudgets(assets, budgets)).toEqual([
      'entry: 101 raw bytes exceeds 100',
      'entry: 51 gzip bytes exceeds 50',
    ]);
  });

  it('sums every matching chunk for an aggregate budget', () => {
    const aggregateBudgets: BundleBudget[] = [
      {
        label: 'all JavaScript',
        pattern: /\.js$/,
        mode: 'aggregate',
        maxRawBytes: 200,
        maxGzipBytes: 100,
      },
    ];
    const assets: BundleAsset[] = [
      { name: 'index.js', rawBytes: 100, gzipBytes: 50 },
      { name: 'lazy.js', rawBytes: 101, gzipBytes: 51 },
      { name: 'styles.css', rawBytes: 900, gzipBytes: 400 },
    ];

    expect(evaluateBundleBudgets(assets, aggregateBudgets)).toEqual([
      'all JavaScript: 201 raw bytes exceeds 200',
      'all JavaScript: 101 gzip bytes exceeds 100',
    ]);
  });

  it('measures emitted JavaScript and CSS bytes deterministically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'protopeek-bundle-budget-'));
    try {
      await writeFile(join(directory, 'index-hash.js'), 'hello');
      await writeFile(join(directory, 'index-hash.js.map'), 'ignored');
      await writeFile(join(directory, 'styles.css'), 'ok');

      expect(await measureBundleDirectory(directory)).toEqual([
        {
          name: 'index-hash.js',
          rawBytes: 5,
          gzipBytes: gzipSync('hello', { level: 9 }).byteLength,
        },
        {
          name: 'styles.css',
          rawBytes: 2,
          gzipBytes: gzipSync('ok', { level: 9 }).byteLength,
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns a failing build result with actionable asset evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'protopeek-bundle-budget-'));
    const output: string[] = [];
    try {
      await writeFile(join(directory, 'index-hash.js'), 'hello');
      const exitCode = await runBundleBudgetCheck(
        directory,
        [{ ...budgets[0], maxRawBytes: 4 }],
        (line) => output.push(line)
      );

      expect(exitCode).toBe(1);
      expect(output).toContain('index-hash.js: 5 raw bytes / 25 gzip bytes');
      expect(output.at(-1)).toBe('Bundle budget FAILED: entry: 5 raw bytes exceeds 4');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
