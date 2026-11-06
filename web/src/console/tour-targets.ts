import type { FeatureId } from './app/feature-registry';

export const mediaTourTargets = [
  '.pp-media-types button[aria-pressed="true"]',
  '[aria-label="Engine setup"]',
  '#media-url',
  '.pp-media-composer button[type="submit"]',
  '[aria-label="Media queue"]',
] as const;
export const mediaTourHints = [
  '',
  '',
  '',
  'Choose and set up an available engine first, then enter the link and destination.',
  '',
] as const;

// One fixed selector per guide step. Selectors identify existing controls or
// evidence; they are only highlighted and focused, never activated.
export const tourTargets: Record<FeatureId, readonly string[]> = {
  overview: [
    'form[aria-label="Open a service"] input',
    'form[aria-label="Open a service"] button[type="submit"]',
  ],
  protocols: ['.pp-protocol-choice-list a'],
  grpc: [
    '[aria-label="gRPC target connection"] [aria-label="Address"]',
    '[aria-label="gRPC target connection"] select',
    '.pp-call-workspace .pp-response-summary',
  ],
  http: ['[aria-label="Request URL"]', '.pp-http-send', '[aria-label="HTTP response evidence"]'],
  events: [
    '.pp-events-connect select',
    '.pp-events-connect button[type="submit"]',
    '.pp-events-connect button[type="button"]',
  ],
  capnp: [
    '[aria-label="Cap’n Proto schema files"]',
    '[aria-label="Cap’n Proto endpoint"]',
    '[aria-label="Cap’n Proto response"]',
  ],
  network: ['#local-network-scope', '.pp-local-service-scan > button'],
  'network-ports': [
    '.pp-ports form input',
    '.pp-ports form button[type="submit"]',
    '.pp-ports-table',
  ],
  'network-diagnostics': [
    '.pp-diag-target select',
    '.pp-diag-run',
    '[aria-label="Diagnostic result"]',
  ],
  netbird: ['.pp-netbird .pp-page-header button', '.pp-netbird-actions'],
  'network-route': ['[aria-label="Route destination"]', '.pp-route-results'],
  'network-nmap': ['.pp-ports-status button', '.pp-ports form input', '.pp-ports-table'],
  'network-packets': ['[aria-label="Packet sources"] button', '[aria-label="Packet results"]'],
  'network-path': ['.pp-path-target input', '.pp-path-run'],
  'network-local': [
    '#local-network-scope',
    '.pp-local-service-scan > button',
    '.pp-local-discovery-detail',
  ],
  'network-map': [
    ':is(.pp-workspace-picker select:has(option:not([value=""])), .pp-network-empty-action)',
    '.pp-workspace-editor',
  ],
  'network-history': [
    ':is([aria-label="Saved network workspaces"] button, .pp-network-empty-action)',
    '.pp-snapshot-timeline',
  ],
  'this-pc': [
    '.this-pc-refresh',
    ':is(.this-pc-tabs, .this-pc-bottom-tabs)',
    '.this-pc-view a[href]',
  ],
  tailnet: ['.pp-tailnet .pp-page-header button', '[aria-label="Tailscale sections"]'],
  extensions: ['[aria-label="Search extensions"]', ':is(.pp-extension-detail, .pp-extension-grid)'],
  tunnels: [
    ':is(.pp-tunnel-setup-heading button, .pp-tunnel-toolbar > button)',
    '#tunnel-tab-routes',
  ],
  publishing: ['.pp-publish-form select', '.pp-publish-review', '.pp-publish-session'],
  downloader: ['#download-source', '.pp-transfer-queue'],
  'local-transfer': [
    ':is(.pp-share-setup input, .pp-share-identity summary)',
    ':is(.pp-share-drop input[type="file"], .pp-share-incoming)',
    '.pp-share-identity > button',
  ],
  security: ['.pp-security-website input', '.pp-security-website button[type="submit"]'],
  settings: ['#settings-tab-appearance', '[aria-label="Settings sections"]'],
  agents: ['.pp-agent-client select', '.pp-agent-primary'],
  updates: [
    '[aria-label="Installed version"]',
    ':is([aria-label="Release update"], [aria-label="Command line updates"])',
  ],
  roadmap: ['[aria-label="Search roadmap"]', '[aria-label="Roadmap status"]'],
};

export const tourHints: Partial<Record<FeatureId, readonly string[]>> = {
  overview: ['', 'Choose a workbench and enter its address.'],
  grpc: [
    'Open the connection form.',
    'Choose a schema in the connection form.',
    'Connect and invoke a method. On a narrow screen, select Response.',
  ],
  http: ['', '', 'Send a request first. On a narrow screen, select Response.'],
  events: ['', 'Disconnect the current stream first.', 'Connect a stream first.'],
  netbird: ['', 'Inspect NetBird first.'],
  tailnet: ['', 'Inspect Tailscale first.'],
  extensions: ['Return to the library to search.', 'Choose a tool to see setup.'],
  capnp: ['', '', 'Invoke a method first. On a narrow screen, select Response.'],
  'network-ports': ['', 'Enter a host and ports.', 'Run a scan to see results.'],
  'network-diagnostics': ['', 'Select a mode and enter its target.', 'Run the diagnostic first.'],
  'network-route': ['', 'Look up a route first.'],
  'network-nmap': ['', 'Check for Nmap and enter a target.', 'Run a scan to see results.'],
  'network-packets': ['', 'Analyze a file or finish a capture.'],
  'network-path': ['', 'Choose a target and available check.'],
  'network-local': ['', 'Choose a scope and review the plan.', 'Run discovery and select a host.'],
  'network-map': ['Save a scan or path, or import a map.', 'Select a saved workspace first.'],
  'network-history': [
    'Save a scan or path, or import a map.',
    'Select a workspace with snapshots.',
  ],
  'this-pc': ['', 'Wait for the device check.', 'Select an item in a device section.'],
  tunnels: ['', 'Inspect the host and select a deployment.'],
  publishing: [
    '',
    'Choose an audience and origin, then Review session.',
    'Start or check a session first.',
  ],
  downloader: ['Select Files.', 'Select Files.'],
  'local-transfer': [
    'Wait for sharing to load or retry.',
    'Enable sharing, then select a device and files.',
    'Enable sharing first.',
  ],
  security: [
    'Select Website response under Website tools.',
    'Select Website response and enter a site.',
  ],
  updates: ['Wait for the installation check.', 'Complete the installation check.'],
};
