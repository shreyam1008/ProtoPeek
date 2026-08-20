export type MetadataEntry = {
  name: string;
  value: string;
};

export type HTTPRequestInput = {
  method: string;
  url: string;
  headers: MetadataEntry[];
  body: string;
  timeoutMs: number;
  followRedirects: boolean;
};

export type HTTPRedirect = {
  url: string;
  status: string;
  statusCode: number;
  location: string;
};

export type HTTPTimings = {
  dnsMs: number;
  connectMs: number;
  tlsMs: number;
  ttfbMs: number;
  totalMs: number;
};

export type HTTPTLSSummary = {
  version: string;
  cipherSuite: string;
  serverName: string;
  peerSubject: string;
  peerExpiresAt: string;
  verified: boolean;
};

export type HTTPResponse = {
  status: string;
  statusCode: number;
  proto: string;
  headers: MetadataEntry[];
  body: string;
  bodyEncoding: 'text' | 'base64';
  bytes: number;
  truncated: boolean;
  redirects: HTTPRedirect[];
  remoteIp: string;
  tls: HTTPTLSSummary | null;
  timings: HTTPTimings;
};

export type HTTPHistoryEntry = {
  id: string;
  createdAt: string;
  method: string;
  url: string;
  requestHeaders: MetadataEntry[];
  status: string;
  statusCode: number;
  totalMs: number;
};

export type BootstrapMethod = {
  name: string;
  fullName: string;
  description: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  requestType: string;
  responseType: string;
};

export type BootstrapService = {
  name: string;
  description: string;
  methods: BootstrapMethod[];
};

export type BootstrapResponse = {
  appName: string;
  version: string;
  target: string;
  launcherMode: boolean;
  initialScanTarget: string;
  basePath: string;
  docsURL: string;
  repoURL: string;
  learnURL: string;
  grpcWebURL: string;
  debuggingURL: string;
  authorName: string;
  authorURL: string;
  defaultMetadata: MetadataEntry[];
  targetDefaults: WorkspaceTargetConfig;
  grpcurlOptions: string;
  services: BootstrapService[];
};

export type WorkspaceTargetConfig = {
  address: string;
  plaintext: boolean;
  insecure: boolean;
  authority: string;
  cacertPath: string;
  certPath: string;
  keyPath: string;
  schemaSource: 'reflection' | 'browser-proto-folder' | 'proto-files' | 'protoset';
  protoFiles: string[];
  importPaths: string[];
  protosets: string[];
};

export type WorkspaceTargetProfile = WorkspaceTargetConfig & {
  id: string;
  name: string;
  notes: string;
  updatedAt: string;
};

export type WorkspaceConnectResponse = {
  sessionId: string;
  bootstrap: BootstrapResponse;
};

export type MethodFilter =
  | 'all'
  | 'unary'
  | 'client-streaming'
  | 'server-streaming'
  | 'bidirectional';

export type FieldType =
  | 'string'
  | 'bytes'
  | 'int32'
  | 'int64'
  | 'sint32'
  | 'sint64'
  | 'uint32'
  | 'uint64'
  | 'fixed32'
  | 'fixed64'
  | 'sfixed32'
  | 'sfixed64'
  | 'float'
  | 'double'
  | 'bool'
  | 'oneof'
  | string;

export type EnumValue = {
  num: number;
  name: string;
};

export type FieldDefinition = {
  name: string;
  protoName: string;
  type: FieldType;
  oneOfFields: FieldDefinition[];
  isMessage: boolean;
  isEnum: boolean;
  isArray: boolean;
  isMap: boolean;
  isRequired: boolean;
  defaultVal: unknown;
  description: string;
};

export type SchemaResponse = {
  requestType: string;
  requestStream: boolean;
  messageTypes: Record<string, FieldDefinition[]>;
  enumTypes: Record<string, EnumValue[]>;
};

export type ExampleRequest = {
  timeout_secs: number;
  metadata: MetadataEntry[];
  data: unknown;
};

export type ExampleResponse = {
  name: string;
  description: string;
  service: string;
  method: string;
  request: ExampleRequest;
};

export type InvokeRequest = {
  timeout_seconds: number;
  metadata: MetadataEntry[];
  data: unknown[];
};

export type InvokeResponseElement = {
  message: unknown;
  isError: boolean;
  sequence: number;
  elapsedMs: number | null;
};

export type InvokeError = {
  code: number;
  name: string;
  message: string;
  details: InvokeResponseElement[];
};

export type InvokeRequestStats = {
  total: number;
  sent: number;
};

export type InvokeTimings = {
  headersMs: number | null;
  firstMessageMs: number | null;
  trailersMs: number | null;
  totalMs: number;
};

export type InvokeResponse = {
  headers: MetadataEntry[];
  error: InvokeError | null;
  responses: InvokeResponseElement[];
  requests: InvokeRequestStats | null;
  trailers: MetadataEntry[];
  timings: InvokeTimings | null;
};

export type SavedCollection = {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  notes: string;
  service: string;
  method: string;
  metadata: MetadataEntry[];
  timeoutSeconds: number;
  requestText: string;
  /** Present on records created after workspace-scoped replay was introduced. */
  targetId?: string;
  /** Target address guards direct-mode and migrated records when no profile ID exists. */
  targetAddress?: string;
};

export type RequestHistoryEntry = {
  id: string;
  createdAt: string;
  service: string;
  method: string;
  latencyMs: number;
  success: boolean;
  requestText: string;
  responsePreview: string;
  metadata: MetadataEntry[];
  timeoutSeconds: number;
  /** Present on records created after workspace-scoped replay was introduced. */
  targetId?: string;
  /** Target address guards direct-mode and migrated records when no profile ID exists. */
  targetAddress?: string;
};

export type WorkspaceExportV1 = {
  format: 'protopeek-workspace';
  version: 1;
  exportedAt: string;
  assertions: AssertionRule[];
  collections: SavedCollection[];
  environments: EnvironmentPreset[];
  targets: WorkspaceTargetProfile[];
};

export type ValidatedWorkspaceImport = {
  legacy: boolean;
  sections: {
    assertions: boolean;
    collections: boolean;
    environments: boolean;
    history: boolean;
    targets: boolean;
  };
  assertions: AssertionRule[];
  collections: SavedCollection[];
  environments: EnvironmentPreset[];
  history?: RequestHistoryEntry[];
  targets: WorkspaceTargetProfile[];
  hasHostFilePaths: boolean;
};

export type RepeatConfig = {
  count: number;
  thinkTimeMs: number;
  deadlineSeconds: number;
};

export type RepeatOutcome = 'ok' | 'grpc-error' | 'relay-transport-error' | 'cancelled';

export type RepeatStopReason = 'completed' | 'user-cancelled' | 'aggregate-limit';

export type RepeatAttempt = {
  sequence: number;
  startedOffsetMs: number;
  consoleRoundTripMs: number;
  handlerInvokeMs: number | null;
  outcome: RepeatOutcome;
  responseCount: number;
  headerCount: number;
  trailerCount: number;
  grpcStatus: {
    code: number;
    name: string;
    message: string;
  } | null;
  error: string;
};

export type RepeatRun = {
  id: string;
  createdAt: string;
  method: string;
  target: string;
  config: RepeatConfig;
  requestedCount: number;
  totalMs: number;
  stopReason: RepeatStopReason;
  counts: {
    ok: number;
    grpcError: number;
    relayTransportError: number;
    cancelled: number;
  };
  latency: {
    sampleCount: number;
    source: 'handler-invoke' | 'console-round-trip';
    minMs: number | null;
    medianMs: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  };
  attempts: RepeatAttempt[];
};

export type RepeatExportV1 = {
  format: 'protopeek-repeat';
  version: 1;
  exportedAt: string;
  run: RepeatRun;
};

export type EnvironmentPreset = {
  id: string;
  name: string;
  notes: string;
  metadata: MetadataEntry[];
  timeoutSeconds: number;
  updatedAt: string;
};

export type AssertionKind =
  | 'status'
  | 'latency_ms'
  | 'header'
  | 'trailer'
  | 'response_count'
  | 'body_text';

export type AssertionComparator = 'equals' | 'contains' | 'lte' | 'gte';

export type AssertionRule = {
  id: string;
  name: string;
  kind: AssertionKind;
  comparator: AssertionComparator;
  target: string;
  value: string;
};

export type AssertionResult = {
  id: string;
  name: string;
  passed: boolean;
  message: string;
};

export type ProtoEnumValue = {
  name: string;
  number: number;
};

export type ProtoEnumSummary = {
  name: string;
  fullName: string;
  values: ProtoEnumValue[];
};

export type ProtoFieldSummary = {
  name: string;
  type: string;
  label: string;
  required: boolean;
  repeated: boolean;
  map: boolean;
  oneOf: string;
};

export type ProtoMessageSummary = {
  name: string;
  fullName: string;
  fields: ProtoFieldSummary[];
  messages: ProtoMessageSummary[];
  enums: ProtoEnumSummary[];
};

export type ProtoMethodSummary = {
  name: string;
  fullName: string;
  requestType: string;
  responseType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
};

export type ProtoServiceSummary = {
  name: string;
  fullName: string;
  methods: ProtoMethodSummary[];
};

export type ProtoFileSummary = {
  name: string;
  package: string;
  dependencies: string[];
  services: ProtoServiceSummary[];
  messages: ProtoMessageSummary[];
  enums: ProtoEnumSummary[];
  protoText: string;
  wellKnown: boolean;
};

export type ProtoCatalogResponse = {
  files: ProtoFileSummary[];
};
