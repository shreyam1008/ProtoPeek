import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  type BundleAsset,
  type BundleBudget,
  consoleBundleBudgets,
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
  it('keeps deliberate console split chunks under explicit budgets', () => {
    const byLabel = (label: string) => {
      const budget = consoleBundleBudgets.find((candidate) => candidate.label === label);
      expect(budget).toBeDefined();
      return budget as BundleBudget;
    };

    expect(byLabel('console framework core JavaScript').pattern.test('console-core-hash.js')).toBe(
      true
    );
    expect(byLabel('shared route icons JavaScript').pattern.test('console-icons-hash.js')).toBe(
      true
    );
    const initial = byLabel('initial console JavaScript');
    expect(initial.mode).toBe('aggregate');
    for (const asset of ['index-hash.js', 'console-core-hash.js', 'rolldown-runtime-hash.js']) {
      expect(initial.pattern.test(asset)).toBe(true);
    }
    expect(initial.pattern.test('console-icons-hash.js')).toBe(false);
  });

  it('accepts an exact-boundary asset', () => {
    const assets: BundleAsset[] = [{ name: 'index-hash.js', rawBytes: 100, gzipBytes: 50 }];

    expect(evaluateBundleBudgets(assets, budgets)).toEqual([]);
  });

  it('counts lazy evidence views in complete journeys while keeping startup ceilings fixed', () => {
    const budget = (label: string) => {
      const found = consoleBundleBudgets.find((candidate) => candidate.label === label);
      expect(found).toBeDefined();
      return found as BundleBudget;
    };
    const network = budget('complete network evidence JavaScript');
    expect(network.mode).toBe('aggregate');
    for (const name of [
      'NetworkWorkbench',
      'NetworkPathPanel',
      'NetworkPathMap',
      'NetworkPathGeography',
      'NetworkNodeActions',
      'HopAttribution',
      'ip-attribution',
      'LocalNetworkPanel',
      'LocalNetworkInventory',
      'local-network',
      'local-network-inventory',
      'local-network-values',
      'network-path',
      'network-path-api',
      'network-path-draft',
      'network-path-geography',
      'TopologyCanvas',
      'network-model',
      'bounded-response',
      'listener-handoff',
    ]) {
      expect(network.pattern.test(`${name}-hash.js`), name).toBe(true);
    }
    expect(network.pattern.test('Unrelated-hash.js')).toBe(false);
    for (const [label, names] of [
      [
        'complete packet inspection JavaScript',
        [
          'PacketWorkbench',
          'PacketReportView',
          'packet-api',
          'packet-analysis',
          'listener-handoff',
        ],
      ],
      [
        'complete This Device views JavaScript',
        ['ThisPC', 'SocketsPanel', 'StatusFact', 'radio', 'listener-handoff'],
      ],
    ] as const) {
      expect(budget(label).mode).toBe('aggregate');
      for (const name of names) expect(budget(label).pattern.test(`${name}-hash.js`)).toBe(true);
    }
    expect(budget('initial console JavaScript').maxRawBytes).toBe(340 * 1024);
    expect(budget('initial console JavaScript').maxGzipBytes).toBe(108 * 1024);
    expect(budget('network workbench JavaScript').maxRawBytes).toBe(144 * 1024);
    expect(budget('network workbench JavaScript').maxGzipBytes).toBe(46 * 1024);
    expect(budget('console CSS').maxRawBytes).toBe(155 * 1024);
    expect(budget('console CSS').maxGzipBytes).toBe(29 * 1024);
    expect(
      evaluateBundleBudgets(
        [
          {
            name: 'NetworkWorkbench-hash.js',
            rawBytes: network.maxRawBytes,
            gzipBytes: network.maxGzipBytes,
          },
          { name: 'NetworkPathMap-hash.js', rawBytes: 1, gzipBytes: 1 },
        ],
        [network]
      )
    ).toEqual([
      `${network.label}: ${network.maxRawBytes + 1} raw bytes exceeds ${network.maxRawBytes}`,
      `${network.label}: ${network.maxGzipBytes + 1} gzip bytes exceeds ${network.maxGzipBytes}`,
    ]);
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
