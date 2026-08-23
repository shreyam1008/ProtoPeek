import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export type BundleAsset = {
  name: string;
  rawBytes: number;
  gzipBytes: number;
};

export type BundleBudget = {
  label: string;
  pattern: RegExp;
  mode?: 'single' | 'aggregate';
  maxRawBytes: number;
  maxGzipBytes: number;
};

const kibibyte = 1024;

export const consoleBundleBudgets: BundleBudget[] = [
  {
    label: 'shared entry JavaScript',
    pattern: /^index-.+\.js$/,
    maxRawBytes: 320 * kibibyte,
    maxGzipBytes: 105 * kibibyte,
  },
  {
    label: 'gRPC workspace JavaScript',
    pattern: /^App-.+\.js$/,
    maxRawBytes: 116 * kibibyte,
    maxGzipBytes: 32 * kibibyte,
  },
  {
    label: 'HTTP workspace JavaScript',
    pattern: /^HTTPRoute-.+\.js$/,
    maxRawBytes: 54 * kibibyte,
    maxGzipBytes: 16 * kibibyte,
  },
  {
    label: 'scan dialog JavaScript',
    pattern: /^ScanTargetDialog-.+\.js$/,
    maxRawBytes: 15 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'console CSS',
    pattern: /^index-.+\.css$/,
    maxRawBytes: 140 * kibibyte,
    maxGzipBytes: 27 * kibibyte,
  },
  // Network diagnostics stay dependency-free and route-lazy. Budget every lazy stage together so
  // moving code between the shell, local scan, topology canvas, and shared model cannot hide growth.
  {
    label: 'network workbench shell JavaScript',
    pattern: /^NetworkWorkbench-.+\.js$/,
    maxRawBytes: 64 * kibibyte,
    maxGzipBytes: 20 * kibibyte,
  },
  {
    label: 'network workbench JavaScript',
    pattern: /^(?:NetworkWorkbench|LocalNetworkPanel|TopologyCanvas|network-model)-.+\.js$/,
    mode: 'aggregate',
    maxRawBytes: 132 * kibibyte,
    maxGzipBytes: 40 * kibibyte,
  },
  {
    label: 'network workbench CSS',
    pattern: /^NetworkWorkbench-.+\.css$/,
    maxRawBytes: 34 * kibibyte,
    maxGzipBytes: 6 * kibibyte,
  },
  {
    label: 'Downloader workspace JavaScript',
    pattern: /^Downloader-.+\.js$/,
    maxRawBytes: 24 * kibibyte,
    maxGzipBytes: 8 * kibibyte,
  },
  {
    label: 'Downloader workspace CSS',
    pattern: /^Downloader-.+\.css$/,
    maxRawBytes: 16 * kibibyte,
    maxGzipBytes: 4 * kibibyte,
  },
  {
    label: 'Downloader advanced-options CSS',
    pattern: /^downloader-advanced-.+\.css$/,
    maxRawBytes: 4 * kibibyte,
    maxGzipBytes: 2 * kibibyte,
  },
  {
    label: 'Security workspace JavaScript',
    pattern: /^Security-.+\.js$/,
    maxRawBytes: 36 * kibibyte,
    maxGzipBytes: 10 * kibibyte,
  },
  {
    label: 'Security evidence-report JavaScript',
    pattern: /^WebsiteEvidenceReport-.+\.js$/,
    maxRawBytes: 12 * kibibyte,
    maxGzipBytes: 4 * kibibyte,
  },
  {
    label: 'Security workspace CSS',
    pattern: /^Security-.+\.css$/,
    maxRawBytes: 22 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'suite shell pages CSS',
    pattern: /^suite-pages-.+\.css$/,
    maxRawBytes: 12 * kibibyte,
    maxGzipBytes: 3 * kibibyte,
  },
  {
    label: 'Settings workspace CSS',
    pattern: /^Settings-.+\.css$/,
    maxRawBytes: 8 * kibibyte,
    maxGzipBytes: 2 * kibibyte,
  },
  // Downloader and Security are route-lazy: neither is transferred when the
  // dashboard or a protocol workbench opens. Keep their own budgets tight,
  // preserve the existing shared-entry ceiling above, and bound the installed
  // suite separately so adding a module cannot hide in code splitting.
  {
    label: 'all console JavaScript',
    pattern: /\.js$/,
    mode: 'aggregate',
    maxRawBytes: 768 * kibibyte,
    maxGzipBytes: 240 * kibibyte,
  },
  {
    label: 'all console CSS',
    pattern: /\.css$/,
    mode: 'aggregate',
    // The stable shared stylesheet remains independently capped above; the
    // aggregate includes every route-lazy feature stylesheet and keeps a
    // deliberately tight regression ceiling above the current measured suite.
    maxRawBytes: 224 * kibibyte,
    maxGzipBytes: 42 * kibibyte,
  },
];

export function evaluateBundleBudgets(assets: BundleAsset[], budgets: BundleBudget[]): string[] {
  const violations: string[] = [];

  for (const budget of budgets) {
    const matcher = new RegExp(budget.pattern.source, budget.pattern.flags);
    const matches = assets.filter((candidate) => {
      matcher.lastIndex = 0;
      return matcher.test(candidate.name);
    });
    if (matches.length === 0) {
      violations.push(`${budget.label}: no matching asset`);
      continue;
    }
    if (budget.mode !== 'aggregate' && matches.length !== 1) {
      violations.push(`${budget.label}: expected one matching asset, found ${matches.length}`);
      continue;
    }
    const measured =
      budget.mode === 'aggregate'
        ? matches.reduce(
            (total, asset) => ({
              rawBytes: total.rawBytes + asset.rawBytes,
              gzipBytes: total.gzipBytes + asset.gzipBytes,
            }),
            { rawBytes: 0, gzipBytes: 0 }
          )
        : matches[0];
    if (measured.rawBytes > budget.maxRawBytes) {
      violations.push(
        `${budget.label}: ${measured.rawBytes} raw bytes exceeds ${budget.maxRawBytes}`
      );
    }
    if (measured.gzipBytes > budget.maxGzipBytes) {
      violations.push(
        `${budget.label}: ${measured.gzipBytes} gzip bytes exceeds ${budget.maxGzipBytes}`
      );
    }
  }

  return violations;
}

export async function measureBundleDirectory(directory: string): Promise<BundleAsset[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const assetNames = entries
    .filter((entry) => entry.isFile() && /\.(?:css|js)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    assetNames.map(async (name) => {
      const content = await readFile(join(directory, name));
      return {
        name,
        rawBytes: content.byteLength,
        gzipBytes: gzipSync(content, { level: 9 }).byteLength,
      };
    })
  );
}

export async function runBundleBudgetCheck(
  directory: string,
  budgets: BundleBudget[] = consoleBundleBudgets,
  output: (line: string) => void = console.log
): Promise<number> {
  const assets = await measureBundleDirectory(directory);
  for (const asset of assets) {
    output(`${asset.name}: ${asset.rawBytes} raw bytes / ${asset.gzipBytes} gzip bytes`);
  }

  const violations = evaluateBundleBudgets(assets, budgets);
  if (violations.length > 0) {
    output(`Bundle budget FAILED: ${violations.join('; ')}`);
    return 1;
  }

  output('Bundle budget OK.');
  return 0;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultAssetDirectory = resolve(
  scriptDirectory,
  '..',
  'internal',
  'resources',
  'app',
  'dist',
  'assets'
);

if (import.meta.main) {
  const directory = process.argv[2] ? resolve(process.argv[2]) : defaultAssetDirectory;
  process.exitCode = await runBundleBudgetCheck(directory);
}
