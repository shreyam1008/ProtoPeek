export type FeatureIdea = {
  name: string;
  summary: string;
  status: 'Shipped' | 'Next';
  rationale: string;
};

export const featureIdeas: FeatureIdea[] = [
  {
    name: 'Schema-first command rail',
    summary: 'Search services and methods from a single sidebar with streaming badges.',
    status: 'Shipped',
    rationale:
      'Postman emphasizes discoverable method selection for gRPC requests, so ProtoPeek keeps service discovery visible instead of burying it in dropdowns.',
  },
  {
    name: 'Protocol dashboard and target registry',
    summary:
      'Start ProtoPeek at a protocol dashboard, scan a bounded target, save multiple gRPC targets, and reconnect without restarting the console.',
    status: 'Shipped',
    rationale:
      'Postman-style launch ergonomics matter, but ProtoPeek keeps them transport-aware by storing reflection mode, descriptor inputs, and TLS flags per target.',
  },
  {
    name: 'Starter payload generator',
    summary:
      'Generate valid JSON scaffolds from reflected protobuf schemas, including nested messages and enums.',
    status: 'Shipped',
    rationale:
      'Reflection is one of the main reasons gRPC tools feel transparent; generating payloads from descriptors removes guesswork for first-time calls.',
  },
  {
    name: 'Proto structure explorer and exporter',
    summary:
      'Inspect full proto files, services, messages, enums, and dependencies, then export the raw contract or catalog JSON.',
    status: 'Shipped',
    rationale:
      'gRPC debugging often starts with the contract, so ProtoPeek now exposes file-level structure instead of limiting users to per-method request forms.',
  },
  {
    name: 'Metadata presets',
    summary:
      'Keep auth and request metadata editable for live calls while redacting sensitive values before history or default export.',
    status: 'Shipped',
    rationale:
      'Postman’s gRPC interface highlights metadata and authorization as first-class request concerns, so the workbench should too.',
  },
  {
    name: 'Collections and recipes',
    summary:
      'Save local request recipes with notes, then import or export them as JSON for quick team handoff.',
    status: 'Shipped',
    rationale:
      'Reusable saved requests plus local workspace transfer cover the common “share what worked” loop without forcing a hosted collection model.',
  },
  {
    name: 'Live response lab',
    summary:
      'Inspect headers, trailers, payloads, errors, and latency in a single response surface.',
    status: 'Shipped',
    rationale:
      'gRPC-specific metadata and trailers are easy to lose in generic tools; ProtoPeek keeps them adjacent to the payload for debugging clarity.',
  },
  {
    name: 'Assertions and validation',
    summary:
      'Run local assertion rules against status, latency, metadata, and payload text without a heavyweight scripting sandbox.',
    status: 'Shipped',
    rationale:
      'Postman supports gRPC test hooks before, during, and after requests; ProtoPeek keeps validation local without adding a scripting runtime.',
  },
  {
    name: 'Unary Repeat',
    summary:
      'Run 2–50 sequential unary checks with explicit deadlines, cancellation, partial results, separate gRPC status and relay/transport failures, and labelled handler-vs-console timing.',
    status: 'Shipped',
    rationale:
      'Bounded repetition extends interactive debugging without presenting browser scheduling or the local relay as a service load benchmark; every attempt remains a real, potentially mutating RPC.',
  },
  {
    name: 'Bounded HTTP workbench',
    summary:
      'Send explicit HTTP(S) requests with native request controls, cancellation, and status, body, redirect, TLS, and phase-timing evidence.',
    status: 'Shipped',
    rationale:
      'HTTP earns a separate protocol surface so it can expose its own semantics without weakening gRPC-specific visibility.',
  },
  {
    name: 'gRPC-Web topology lens',
    summary:
      'Explain browser transport limits, Envoy bridging, and header/trailer behavior next to the console itself.',
    status: 'Shipped',
    rationale:
      'gRPC-Web has operational caveats that matter for frontend teams, and tooling should teach those constraints instead of assuming backend-only context.',
  },
];
