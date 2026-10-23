import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import extensionManifest from '../web/src/console/extension-manifest.json';

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
  requiredMembers?: RegExp[];
};

const kibibyte = 1024;
// Gzip measurements use release CI's pinned Bun 1.3.10 node:zlib implementation.
// Bun 1.4/Node compress the identical assets differently. The release baseline is
// 363,160 JS / 61,743 CSS gzip bytes; raw and initial-transfer ceilings are unchanged.

export const consoleBundleBudgets: BundleBudget[] = [
  ...extensionManifest.map(({ id, name }) => ({
    label: `Optional ${name} setup JavaScript`,
    pattern: new RegExp(`^extension-${id}-.+\\.js$`),
    maxRawBytes: 1.5 * kibibyte,
    maxGzipBytes: 0.8 * kibibyte,
  })),
  {
    label: 'Complete optional extension library JavaScript',
    pattern: new RegExp(
      `^(?:Extensions|ExtensionDetails|AgentClientSetup|extension-(?:catalog|${extensionManifest.map(({ id }) => id).join('|')}))-.+\\.js$`
    ),
    mode: 'aggregate',
    requiredMembers: [
      /^Extensions-.+\.js$/,
      /^ExtensionDetails-.+\.js$/,
      /^AgentClientSetup-.+\.js$/,
      /^extension-catalog-.+\.js$/,
      ...extensionManifest.map(({ id }) => new RegExp(`^extension-${id}-.+\\.js$`)),
    ],
    // Measured 20 independently lazy packs, index, detail and client setup. No vendor runtime.
    maxRawBytes: 46 * kibibyte,
    maxGzipBytes: 22 * kibibyte,
  },
  {
    label: 'Optional extension detail CSS',
    pattern: /^ExtensionDetails-.+\.css$/,
    maxRawBytes: 2.5 * kibibyte,
    maxGzipBytes: 1 * kibibyte,
  },
  // October networking family: independently lazy features. All assets still
  // count toward suite totals; existing workbench and startup caps stay below.
  {
    label: 'Connection diagnostics JavaScript',
    pattern: /^NetworkDiagnostics-.+\.js$/,
    maxRawBytes: 24 * kibibyte,
    maxGzipBytes: 8 * kibibyte,
  },
  {
    label: 'HTTP profile and import JavaScript',
    pattern: /^(?:HTTPEnvironmentControls|HTTPImportPanel|http-execution)-.+\.js$/,
    mode: 'aggregate',
    // Native browser cURL quoting/cookie support, bounded decoding and explicit
    // compression notices measure 16,484 raw / 6,789 gzip. No shell runtime.
    maxRawBytes: 17 * kibibyte,
    maxGzipBytes: 7 * kibibyte,
  },
  {
    label: 'HTTP shared library JavaScript',
    pattern: /^http-library-.+\.js$/,
    maxRawBytes: 14 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'Incremental gRPC evidence JavaScript',
    pattern: /^(?:grpc-invoke-stream|GrpcResponseEvidence)-.+\.js$/,
    mode: 'aggregate',
    maxRawBytes: 11 * kibibyte,
    maxGzipBytes: 4.5 * kibibyte,
  },
  {
    label: 'Network history additions JavaScript',
    pattern: /^(?:NetworkSnapshotComparison|NmapTopologyPreview|nmap-to-network)-.+\.js$/,
    mode: 'aggregate',
    maxRawBytes: 14 * kibibyte,
    maxGzipBytes: 5.5 * kibibyte,
  },
  {
    label: 'Packet payload and conversation additions JavaScript',
    pattern: /^(?:PacketReconstruction|PacketConversations)-.+\.js$/,
    mode: 'aggregate',
    maxRawBytes: 11 * kibibyte,
    maxGzipBytes: 4.5 * kibibyte,
  },
  {
    label: 'Temporary publishing and canonical config JavaScript',
    pattern: /^(?:PublishingWorkbench|CloudflareOperations)-.+\.js$/,
    mode: 'aggregate',
    // Hash-bound rollback reference recovery survives tab/route remounts without
    // retaining YAML or credentials: 22,956 raw / 8,284 gzip for both lazy views.
    maxRawBytes: 23 * kibibyte,
    maxGzipBytes: 8.5 * kibibyte,
  },
  {
    label: 'Private network additions JavaScript',
    pattern: /^(?:NetBirdWorkbench|HeadscaleAccount|TailnetOperationReview)-.+\.js$/,
    mode: 'aggregate',
    maxRawBytes: 13 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'Cap’n Proto call plans JavaScript',
    pattern: /^(?:CapnpAdvancedPanel|capnp-plan-api)-.+\.js$/,
    mode: 'aggregate',
    maxRawBytes: 10 * kibibyte,
    maxGzipBytes: 4 * kibibyte,
  },
  {
    label: 'Session activity JavaScript',
    pattern: /^(?:OperationHistory|OperationHistoryControl|operation-receipts)-.+\.js$/,
    mode: 'aggregate',
    maxRawBytes: 7 * kibibyte,
    maxGzipBytes: 3.5 * kibibyte,
  },
  {
    label: 'Networking family additions CSS',
    pattern:
      /^(?:NetworkDiagnostics|http-tools|snapshot-comparison|PacketReconstruction|PublishingWorkbench|CloudflareOperations|NetBirdWorkbench|CapnpAdvancedPanel|OperationHistory)-.+\.css$/,
    mode: 'aggregate',
    requiredMembers: [
      /^NetworkDiagnostics-.+\.css$/,
      /^http-tools-.+\.css$/,
      /^snapshot-comparison-.+\.css$/,
      /^PacketReconstruction-.+\.css$/,
      /^PublishingWorkbench-.+\.css$/,
      /^CloudflareOperations-.+\.css$/,
      /^NetBirdWorkbench-.+\.css$/,
      /^CapnpAdvancedPanel-.+\.css$/,
      /^OperationHistory-.+\.css$/,
    ],
    maxRawBytes: 14 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'Extensions workspace JavaScript',
    pattern: /^Extensions-.+\.js$/,
    maxRawBytes: 12 * kibibyte,
    maxGzipBytes: 5 * kibibyte,
  },
  {
    label: 'Extensions workspace CSS',
    pattern: /^Extensions-.+\.css$/,
    maxRawBytes: 2.7 * kibibyte,
    maxGzipBytes: 1.05 * kibibyte,
  },
  // Updates is loaded only when opened: measured 8,494 JS / 3,132 CSS raw,
  // 3,057 JS / 1,062 CSS gzip bytes. Startup budgets remain unchanged.
  {
    label: 'Update workspace JavaScript',
    pattern: /^Updates-.+\.js$/,
    maxRawBytes: 10 * kibibyte,
    maxGzipBytes: 4 * kibibyte,
  },
  {
    label: 'Update workspace CSS',
    pattern: /^Updates-.+\.css$/,
    maxRawBytes: 4 * kibibyte,
    maxGzipBytes: 2 * kibibyte,
  },
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
    label: 'Packet report JavaScript',
    pattern: /^PacketReportView-.+\.js$/,
    maxRawBytes: 8 * kibibyte,
    maxGzipBytes: 3 * kibibyte,
  },
  {
    label: 'complete packet inspection JavaScript',
    pattern:
      /^(?:PacketWorkbench|PacketReportView|packet-api|packet-analysis|listener-handoff)-.+\.js$/,
    mode: 'aggregate',
    maxRawBytes: 21 * kibibyte,
    maxGzipBytes: 8 * kibibyte,
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
    pattern:
      /^(?:index|console-core|console-icons|rolldown-runtime|circle-alert|loader-circle|chevron-right)-.+\.js$/,
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
    label: 'port scanner JavaScript',
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
    // Shared navigation, responsive workspace grammar and recoverable route states.
    // September UI review: 156,669 raw / 28,912 gzip; see guides/ui-overhaul-2026-09.md.
    maxRawBytes: 155 * kibibyte,
    maxGzipBytes: 29 * kibibyte,
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
    label: 'Nearby devices inventory JavaScript',
    pattern: /^LocalNetworkInventory-.+\.js$/,
    maxRawBytes: 10 * kibibyte,
    maxGzipBytes: 4 * kibibyte,
  },
  {
    label: 'selected device actions JavaScript',
    pattern: /^NetworkNodeActions-.+\.js$/,
    maxRawBytes: 3 * kibibyte,
    maxGzipBytes: 2 * kibibyte,
  },
  {
    label: 'Nearby devices inventory model JavaScript',
    pattern: /^local-network-inventory-.+\.js$/,
    maxRawBytes: 6 * kibibyte,
    maxGzipBytes: 3 * kibibyte,
  },
  {
    label: 'Nearby devices inventory CSS',
    pattern: /^LocalNetworkInventory-.+\.css$/,
    maxRawBytes: 4 * kibibyte,
    maxGzipBytes: 2 * kibibyte,
  },
  {
    label: 'measured hop map JavaScript',
    pattern: /^NetworkPathMap-.+\.js$/,
    maxRawBytes: 5 * kibibyte,
    maxGzipBytes: 2 * kibibyte,
  },
  {
    label: 'approximate hop geography JavaScript',
    pattern: /^NetworkPathGeography-.+\.js$/,
    // Includes simplified offline land outlines; no map dependency or tile requests.
    maxRawBytes: 16 * kibibyte,
    maxGzipBytes: 7 * kibibyte,
  },
  {
    label: 'complete network evidence JavaScript',
    pattern:
      /^(?:NetworkWorkbench|NetworkPathPanel|NetworkPathMap|NetworkPathGeography|NetworkNodeActions|HopAttribution|ip-attribution|LocalNetworkPanel|LocalNetworkInventory|local-network(?:-inventory|-values)?|network-path(?:-api|-draft|-geography)?|TopologyCanvas|network-model|bounded-response|listener-handoff)-.+\.js$/,
    mode: 'aggregate',
    // Includes every new lazy evidence stage and shared model. The existing base
    // view budget stays above, so neither initial loading nor splitting hides growth.
    maxRawBytes: 188 * kibibyte,
    maxGzipBytes: 64 * kibibyte,
  },
  {
    label: 'complete network evidence CSS',
    pattern:
      /^(?:NetworkWorkbench|NetworkPathPanel|NetworkPathMap|NetworkPathGeography|HopAttribution|LocalNetworkPanel|LocalNetworkInventory)-.+\.css$/,
    mode: 'aggregate',
    maxRawBytes: 44 * kibibyte,
    maxGzipBytes: 9 * kibibyte,
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
    label: 'This Device sockets JavaScript',
    pattern: /^SocketsPanel-.+\.js$/,
    maxRawBytes: 10 * kibibyte,
    maxGzipBytes: 4 * kibibyte,
  },
  {
    label: 'complete This Device views JavaScript',
    pattern: /^(?:ThisPC|SocketsPanel|StatusFact|radio|listener-handoff)-.+\.js$/,
    mode: 'aggregate',
    // The separately budgeted benchmark engine is fetched only for that operation.
    maxRawBytes: 62 * kibibyte,
    maxGzipBytes: 19 * kibibyte,
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
    // Keep all lazy tools counted, including the shared lightweight pagination helper.
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
    // Navigation resume and searchable roadmap: 1,125,024 raw / 370,820 gzip.
    // Nearby inventory, service advertisements, logical/geographic maps, website
    // handoffs and packet conversations expand the installed feature set. Measured
    // September 27 with pinned Bun 1.3.10: 1,196,780 raw / 398,463 gzip bytes before
    // the logical-map split. These features have individual and complete-journey
    // caps above. All existing startup and base-view ceilings remain unchanged.
    // October pinned-Bun baseline: 1,185,617 raw / 396,342 gzip. Final family
    // build: 1,331,085 raw / 454,213 gzip (+145,468 / 57,871). This measured
    // allocation includes protocol evidence, strict cURL decoding, rollback
    // recovery and all named lazy views, with no new frontend runtime dependency.
    // It exceeds the initial provisional 128/40 KiB estimate; the owner requested
    // the full family/roadmap. Admission is bounded here, with <18 KiB raw spare,
    // every asset counted, and original startup/base-workbench ceilings intact.
    // October 23: the requested20-entry optional library, client-format setup,
    // and workflow repairs measure 1,371,420 /473,640 (+40,335 /19,427).
    // Every pack has an individual cap and the complete lazy journey is capped.
    // Original startup, Home, HTTP/gRPC and shared/base CSS ceilings remain fixed.
    maxRawBytes: 1355 * kibibyte,
    maxGzipBytes: 470 * kibibyte,
  },
  {
    label: 'all console CSS',
    pattern: /\.css$/,
    mode: 'aggregate',
    // The stable shared stylesheet remains independently capped above; the
    // aggregate includes every route-lazy feature stylesheet. The Tunnels
    // slice moves the measured suite baseline to 298,722 raw / 53,806 gzip
    // bytes; keep small explicit headroom without hiding route growth.
    // Complete UI normalization: 342,940 raw / 67,296 gzip across every route.
    // No dependency added; startup JS limits remain unchanged.
    // Pinned-Bun baseline 364,765 raw / 73,711 gzip; family 379,499 / 79,075.
    // Growth 14,734 / 5,364 covers lazy evidence/forms and accessible mobile
    // scrolling. Shared and existing base CSS caps stay fixed.
    // Twenty-entry library/detail and mobile access:384,591 raw (+5,092).
    maxRawBytes: 380 * kibibyte,
    maxGzipBytes: 80 * kibibyte,
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
    for (const required of budget.requiredMembers ?? []) {
      if (!matches.some((asset) => new RegExp(required.source, required.flags).test(asset.name)))
        violations.push(`${budget.label}: missing required member ${required.source}`);
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

  // Follow HTML modulepreloads and emitted static ESM imports. Lazy imports are
  // excluded; a new eager helper cannot evade startup accounting by its name.
  const startup = budgets.some((budget) => budget.label === 'initial console JavaScript')
    ? await startupAssetNames(directory)
    : new Set<string>();
  const startupPattern = new RegExp(
    `^(?:${[...startup].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`
  );
  const effectiveBudgets = budgets.map((budget) =>
    budget.label === 'initial console JavaScript' ? { ...budget, pattern: startupPattern } : budget
  );
  const violations = evaluateBundleBudgets(assets, effectiveBudgets);
  if (violations.length > 0) {
    output(`Bundle budget FAILED: ${violations.join('; ')}`);
    return 1;
  }

  output('Bundle budget OK.');
  return 0;
}

export function staticJavaScriptImports(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:^|[;\n]|\*\/)\s*(?:import|export)\s*(?!\s*\()(?:[^;]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g
    ),
  ].map((match) => match[1]);
}

export async function startupAssetNames(directory: string): Promise<Set<string>> {
  const html = await readFile(join(directory, '..', 'index.html'), 'utf8');
  const pending = [...html.matchAll(/(?:src|href)=["']\.?\/assets\/([^"']+\.js)["']/g)].map(
    (match) => match[1]
  );
  if (!pending.some((name) => /^index-.+\.js$/.test(name)))
    throw new Error('Missing console startup index JavaScript in emitted HTML');
  const result = new Set<string>();
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name) continue;
    if (result.has(name)) continue;
    if (name.includes('/') || name.includes('\\'))
      throw new Error('Unexpected nested startup asset');
    result.add(name);
    pending.push(...staticJavaScriptImports(await readFile(join(directory, name), 'utf8')));
  }
  return result;
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
