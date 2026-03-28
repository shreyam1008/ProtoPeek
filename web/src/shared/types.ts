export type MetadataEntry = {
  name: string;
  value: string;
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
  schemaSource: 'reflection' | 'proto-files' | 'protoset';
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

export type InvokeResponse = {
  headers: MetadataEntry[];
  error: InvokeError | null;
  responses: InvokeResponseElement[];
  requests: InvokeRequestStats | null;
  trailers: MetadataEntry[];
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
};

export type SimulationConfig = {
  runs: number;
  concurrency: number;
  thinkTimeMs: number;
};

export type SimulationRun = {
  id: string;
  createdAt: string;
  method: string;
  config: SimulationConfig;
  totalMs: number;
  successCount: number;
  errorCount: number;
  throughputRps: number;
  latencies: number[];
  p50: number;
  p95: number;
  p99: number;
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
