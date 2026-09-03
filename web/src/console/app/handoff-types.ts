/** Legacy route capability vocabulary; keep until the existing consumers migrate. */
export const handoffKinds = ['grpc-target-draft', 'http-url-draft'] as const;

export const handoffDraftKinds = [
  ...handoffKinds,
  'next-hop-target-draft',
  'publish-origin-draft',
] as const;

export type HandoffKind = (typeof handoffDraftKinds)[number];

export const handoffEnvelopeVersion = 1 as const;

export type HTTPURLRef = {
  kind: 'http-url';
  url: string;
};

export type GRPCTargetRef = {
  kind: 'grpc-target';
  address: string;
  plaintext: boolean;
};

export type NextHopTargetRef = {
  kind: 'next-hop-target';
  target: string;
};

export type TargetRef = HTTPURLRef | GRPCTargetRef | NextHopTargetRef;

export type LocalServiceProtocol = 'http' | 'https' | 'h2c' | 'grpc' | 'grpcs' | 'tcp';

export type LocalServiceExposure =
  | 'loopback-only'
  | 'interface-bound'
  | 'all-interfaces'
  | 'unknown';

export type LocalServiceRef = {
  kind: 'local-service';
  perspective: 'process-network-namespace';
  network: 'tcp';
  bind: {
    address: string;
    wildcard: boolean;
  };
  exposure: LocalServiceExposure;
  protocol: LocalServiceProtocol;
  host: string;
  port: number;
};

export type HandoffEvidenceQuality = 'observed' | 'inferred' | 'manual';

export type HandoffProvenance = {
  source: string;
  quality: HandoffEvidenceQuality;
  observedAt: string;
  path?: string;
  evidenceIds?: string[];
};

export type HandoffDraft =
  | { kind: 'http-url-draft'; target: HTTPURLRef }
  | { kind: 'grpc-target-draft'; target: GRPCTargetRef }
  | { kind: 'next-hop-target-draft'; target: NextHopTargetRef }
  | { kind: 'publish-origin-draft'; origin: LocalServiceRef };

export type HandoffEnvelope = {
  version: typeof handoffEnvelopeVersion;
  id: string;
  createdAt: string;
  expiresAt: string;
  provenance: HandoffProvenance;
  draft: HandoffDraft;
};

export type PendingHandoffInput = {
  provenance: HandoffProvenance;
  draft: HandoffDraft;
};

export type HandoffEnvelopeFor<Kind extends HandoffKind> = Omit<HandoffEnvelope, 'draft'> & {
  draft: Extract<HandoffDraft, { kind: Kind }>;
};
