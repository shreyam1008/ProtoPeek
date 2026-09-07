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
// Gzip measurements use release CI's pinned Bun 1.3.10 node:zlib implementation.
// Bun 1.4/Node compress the identical assets differently. The release baseline is
// 363,160 JS / 61,743 CSS gzip bytes; raw and initial-transfer ceilings are unchanged.

export const consoleBundleBudgets: BundleBudget[] = [
  {
    label: 'AI agent workspace JavaScript',
    pattern: /^AgentWorkbench-.+\.js$/,
    maxRawBytes: 14 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'AI agent workspace CSS',
    pattern: /^AgentWorkbench-.+\.css$/,
    maxRawBytes: 6 * kibibyte,
    maxGzipBytes: 2 * kibibyte,
  },
  {
    label: 'Saved HTTP request library JavaScript',
    pattern: /^HTTPRequestLibrary-.+\.js$/,
    maxRawBytes: 7 * kibibyte,
    maxGzipBytes: 3 * kibibyte,
  },
  {
    label: 'Packet inspection JavaScript',
    pattern: /^PacketWorkbench-.+\.js$/,
    maxRawBytes: 14 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'Cap’n Proto workspace JavaScript',
    pattern: /^CapnpWorkbench-.+\.js$/,
    maxRawBytes: 16 * kibibyte,
    maxGzipBytes: 6 * kibibyte,
  },
  {
    label: 'Home workspace JavaScript',
    pattern: /^Dashboard-.+\.js$/,
    maxRawBytes: 6 * kibibyte,
    maxGzipBytes: 3 * kibibyte,
  },
  {
    label: 'Tailscale workspace JavaScript',
    pattern: /^TailnetWorkbench-.+\.js$/,
    maxRawBytes: 15 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'shared entry JavaScript',
    pattern: /^index-.+\.js$/,
    maxRawBytes: 320 * kibibyte,
    maxGzipBytes: 105 * kibibyte,
  },
  {
    label: 'console framework core JavaScript',
    pattern: /^console-core-.+\.js$/,
    // React, Router, Lucide's factory, and the tiny shared runtime are already required at start.
    maxRawBytes: 268 * kibibyte,
    maxGzipBytes: 89 * kibibyte,
  },
  {
    label: 'shared route icons JavaScript',
    pattern: /^console-icons-.+\.js$/,
    // Reused route icons share one lazy request; feature-only icons remain in their route chunks.
    maxRawBytes: 6 * kibibyte,
    maxGzipBytes: 3 * kibibyte,
  },
  {
    label: 'initial console JavaScript',
    pattern: /^(?:index|console-core|rolldown-runtime)-.+\.js$/,
    mode: 'aggregate',
    // Bound the actual startup graph as well as each named chunk above.
    maxRawBytes: 340 * kibibyte,
    maxGzipBytes: 108 * kibibyte,
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
    // OpenAPI import remains behind independent lazy parser/UI chunks. The
    // measured base route is 54.68 KiB / 16.35 KiB gzip; retain tight headroom.
    maxRawBytes: 56 * kibibyte,
    maxGzipBytes: 17 * kibibyte,
  },
  {
    label: 'event stream workspace JavaScript',
    pattern: /^EventStreamWorkbench-.+\.js$/,
    maxRawBytes: 10 * kibibyte,
    maxGzipBytes: 4 * kibibyte,
  },
  {
    label: 'port scanner with TanStack Table JavaScript',
    pattern: /^PortScanner-.+\.js$/,
    // Includes bounded browser draft and observation recovery.
    maxRawBytes: 44 * kibibyte,
    maxGzipBytes: 14 * kibibyte,
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
    maxRawBytes: 141 * kibibyte,
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
    pattern:
      /^(?:NetworkWorkbench|NetworkPathPanel|HopAttribution|ip-attribution|LocalNetworkPanel|TopologyCanvas|network-model|bounded-response)-.+\.js$/,
    mode: 'aggregate',
    // Path controls now load only in the Path section. Include the optional IP
    // labels and shared validators in this aggregate: ~139 KiB raw / 44 KiB gzip.
    maxRawBytes: 144 * kibibyte,
    maxGzipBytes: 46 * kibibyte,
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
    // Host history, restore/stop controls and foreground progress: 24,860 raw bytes.
    maxRawBytes: 25 * kibibyte,
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
    label: 'This Device workspace JavaScript',
    pattern: /^ThisPC-.+\.js$/,
    maxRawBytes: 58 * kibibyte,
    maxGzipBytes: 17 * kibibyte,
  },
  {
    label: 'This Device benchmark engine JavaScript',
    pattern: /^speedtest-.+\.js$/,
    maxRawBytes: 64 * kibibyte,
    maxGzipBytes: 18 * kibibyte,
  },
  {
    label: 'This Device workspace CSS',
    pattern: /^ThisPC-.+\.css$/,
    maxRawBytes: 24 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'Tunnels workspace JavaScript',
    pattern: /^Tunnels-.+\.js$/,
    // The route owns bounded API normalization, real host/setup evidence,
    // confirmed service actions, and workbench handoffs without a new state
    // or UI library. The verified state-aware baseline is 55,430 raw /
    // 14,555 gzip bytes; route planning is budgeted separately below.
    maxRawBytes: 58 * kibibyte,
    maxGzipBytes: 16 * kibibyte,
  },
  {
    label: 'Tunnels route planner JavaScript',
    pattern: /^RoutePlanner-.+\.js$/,
    // Loaded only when an operator opens the browser-only draft workflow.
    maxRawBytes: 8 * kibibyte,
    maxGzipBytes: 3 * kibibyte,
  },
  {
    label: 'Tunnels route model JavaScript',
    pattern: /^route-plan-.+\.js$/,
    // Shared pure validation/serialization stays small and independently visible.
    maxRawBytes: 3 * kibibyte,
    maxGzipBytes: 2 * kibibyte,
  },
  {
    label: 'Tunnels workspace CSS',
    pattern: /^Tunnels-.+\.css$/,
    // The verified real-host setup/control workspace is 45.96 KiB /
    // 7.14 KiB gzip and remains isolated in the route-lazy stylesheet.
    maxRawBytes: 48 * kibibyte,
    maxGzipBytes: 8 * kibibyte,
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
    // Host controls, directory picker and vertical sections measure about 14 KiB raw.
    // This stylesheet remains route-lazy; startup and gzip caps are unchanged.
    maxRawBytes: 15 * kibibyte,
    maxGzipBytes: 3 * kibibyte,
  },
  // Downloader, Security, This Device, and Tunnels are route-lazy: none is transferred when Home
  // or another workbench opens. Keep their own budgets tight,
  // preserve the existing shared-entry ceiling above, and bound the installed
  // suite separately so adding a module cannot hide in code splitting.
  {
    label: 'all console JavaScript',
    pattern: /\.js$/,
    mode: 'aggregate',
    // September overhaul: bounded HTTP draft recovery, JSON formatting, protocol help,
    // and lazy TanStack fuzzy search measure 952,474 raw / 292,382 gzip bytes.
    // Search no longer enters the startup graph. Keep the startup budgets unchanged.
    // WebSocket/SSE adds a separately lazy 8.7 KiB / 3.4 KiB gzip route.
    // Host scanning and TanStack Table's modular pagination add a lazy ~40 KiB route.
    // Optional Nmap adds 8.2 KiB raw / 3.1 KiB gzip, wholly route-lazy.
    // Installed Tailscale workflows add 13.5 KiB / 4.3 KiB gzip, route-lazy.
    // Website path plan, TLS failure metadata, safe target memory and name handoffs
    // bring the measured aggregate to 1,056,816 raw / 329,045 gzip bytes.
    // Cap’n Proto adds 12.4 KiB / 4.4 KiB gzip. Home is now route-lazy too,
    // avoiding its API and rendering modules when another tool is opened.
    // Measured all-route total: 1,079,728 raw / 340,349 gzip; startup caps unchanged.
    // Includes the lazy packet reader UI (~13 KiB raw / 4.5 KiB gzip).
    // Native settings sections and truthful gRPC clipboard results: 1,106,550 raw / 350,226 gzip.
    // Local agent setup/activity adds a ~11 KiB route and reuses the HTTP response panel.
    // No model runtime, polling in other routes, or additional startup dependency.
    maxRawBytes: 1098 * kibibyte,
    // Saved HTTP requests add a lazy 6.3 KiB / 2.4 KiB gzip panel and reuse the draft codec.
    maxGzipBytes: 362 * kibibyte,
  },
  {
    label: 'all console CSS',
    pattern: /\.css$/,
    mode: 'aggregate',
    // The stable shared stylesheet remains independently capped above; the
    // aggregate includes every route-lazy feature stylesheet. The Tunnels
    // slice moves the measured suite baseline to 298,722 raw / 53,806 gzip
    // bytes; keep small explicit headroom without hiding route growth.
    maxRawBytes: 310 * kibibyte,
    maxGzipBytes: 63 * kibibyte,
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
