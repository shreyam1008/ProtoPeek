import { readBoundedText } from '@/shared/bounded-response';

export type CapnpMethod = {
  interfaceId: string;
  interfaceName: string;
  ordinal: number;
  name: string;
  paramsId: string;
  resultsId: string;
  fields: { name: string; type: string; union: boolean }[];
  typeParameters?: { scopeId: string; index: number; name: string }[];
  implicitParameters?: string[];
  resultCapabilities?: { path: string[]; interfaceId: string }[];
};
export type CapnpSchema = { schemaBase64: string; methods: CapnpMethod[]; nodeCount: number };
export type CapnpResult = {
  address: string;
  remoteAddress: string;
  transport: string;
  tlsVersion?: string;
  durationMs: number;
  observedAt: string;
  result: unknown;
  plan?: {
    sentSteps: number;
    completed: boolean;
    steps: {
      step: number;
      interfaceId: string;
      ordinal: number;
      result: unknown;
      error?: string;
    }[];
  };
};
export type CapnpSource = { path: string; source: string };

export async function requestCapnp(
  path: string,
  input: unknown,
  signal: AbortSignal,
  maxBytes: number,
  rawBody?: string
) {
  const response = await fetch(new URL(`api/capnp/${path}`, window.location.href), {
    method: input === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token':
        document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '',
    },
    body: rawBody ?? (input === undefined ? undefined : JSON.stringify(input)),
  });
  const body = await readBoundedText(response, maxBytes);
  if (body.truncated) throw new Error('Cap’n Proto response exceeded its size limit.');
  if (!response.ok) throw new Error(body.text.slice(0, 4096) || 'Cap’n Proto request failed.');
  return JSON.parse(body.text);
}

export async function capnpCapabilities(signal: AbortSignal) {
  const data = await requestCapnp('capabilities', undefined, signal, 16 * 1024);
  if (typeof data?.available !== 'boolean')
    throw new Error('Invalid compiler capability response.');
  return {
    available: data.available,
    reason: typeof data.reason === 'string' ? data.reason.slice(0, 1024) : '',
  };
}

export async function loadCapnpSchema(
  input: { schemaBase64?: string; files?: CapnpSource[]; root?: string },
  signal: AbortSignal
): Promise<CapnpSchema> {
  const data = await requestCapnp('schema', input, signal, 4 * 1024 * 1024);
  if (
    typeof data?.schemaBase64 !== 'string' ||
    data.schemaBase64.length > 2796204 ||
    !Number.isInteger(data.nodeCount) ||
    data.nodeCount < 1 ||
    data.nodeCount > 1024 ||
    !Array.isArray(data.methods) ||
    data.methods.length > 256
  )
    throw new Error('Invalid compiled schema response.');
  const keys = new Set<string>();
  for (const method of data.methods) {
    if (
      !method ||
      !/^0x[\da-f]{1,16}$/i.test(method.interfaceId) ||
      typeof method.interfaceName !== 'string' ||
      method.interfaceName.length > 512 ||
      typeof method.name !== 'string' ||
      method.name.length > 128 ||
      !Number.isInteger(method.ordinal) ||
      method.ordinal < 0 ||
      method.ordinal > 127 ||
      !Array.isArray(method.fields) ||
      method.fields.length > 256
    )
      throw new Error('Invalid schema method.');
    const key = `${method.interfaceId}/${method.ordinal}`;
    if (keys.has(key)) throw new Error('Duplicate schema method.');
    keys.add(key);
    if (
      method.typeParameters !== undefined &&
      (!Array.isArray(method.typeParameters) ||
        method.typeParameters.length > 64 ||
        method.typeParameters.some(
          (item: { scopeId?: unknown; index?: unknown; name?: unknown }) =>
            !item ||
            typeof item.scopeId !== 'string' ||
            !/^0x[\da-f]{1,16}$/i.test(item.scopeId) ||
            !Number.isInteger(item.index) ||
            (item.index as number) < 0 ||
            (item.index as number) > 63 ||
            typeof item.name !== 'string' ||
            item.name.length > 128
        ))
    )
      throw new Error('Invalid generic parameter description.');
    if (
      method.implicitParameters !== undefined &&
      (!Array.isArray(method.implicitParameters) ||
        method.implicitParameters.length > 64 ||
        method.implicitParameters.some(
          (name: unknown) => typeof name !== 'string' || name.length > 128
        ))
    )
      throw new Error('Invalid generic method description.');
    if (
      method.resultCapabilities !== undefined &&
      (!Array.isArray(method.resultCapabilities) ||
        method.resultCapabilities.length > 32 ||
        method.resultCapabilities.some(
          (value: { path?: unknown; interfaceId?: unknown }) =>
            !value ||
            !Array.isArray(value.path) ||
            value.path.length < 1 ||
            value.path.length > 8 ||
            value.path.some((name: unknown) => typeof name !== 'string' || name.length > 128) ||
            typeof value.interfaceId !== 'string' ||
            !/^0x[\da-f]{1,16}$/i.test(value.interfaceId)
        ))
    )
      throw new Error('Invalid capability field description.');
    for (const field of method.fields) {
      if (
        !field ||
        typeof field.name !== 'string' ||
        field.name.length > 128 ||
        typeof field.type !== 'string' ||
        field.type.length > 1024 ||
        typeof field.union !== 'boolean'
      )
        throw new Error('Invalid schema field.');
    }
  }
  return data;
}

export async function callCapnp(
  input: {
    schemaBase64: string;
    address: string;
    transport: string;
    serverName: string;
    rootCaPem: string;
    interfaceId: string;
    ordinal: number;
    timeoutMs: number;
    params: string;
    typeBindings?: Record<string, string[]>;
    methodTypes?: string[];
  },
  signal: AbortSignal
): Promise<CapnpResult> {
  // Check syntax but send the original JSON token stream. Parsing and then
  // re-stringifying would round unquoted 64-bit integers in JavaScript.
  JSON.parse(input.params);
  const { params, ...metadata } = input;
  const body = `${JSON.stringify(metadata).slice(0, -1)},"params":${params}}`;
  const data = await requestCapnp('call', input, signal, 128 * 1024, body);
  if (
    !data ||
    data.address !== input.address ||
    data.transport !== input.transport ||
    typeof data.remoteAddress !== 'string' ||
    data.remoteAddress.length > 320 ||
    !Number.isFinite(data.durationMs) ||
    data.durationMs < 0 ||
    typeof data.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(data.observedAt)) ||
    !Object.hasOwn(data, 'result')
  )
    throw new Error('Invalid RPC result.');
  return data;
}

export async function readCapnpFiles(
  files: File[]
): Promise<{ schemaBase64?: string; files?: CapnpSource[]; root?: string }> {
  if (!files.length || files.length > 32)
    throw new Error('Choose 1–32 .capnp files or one compiled .bin schema.');
  if (files.length === 1 && !files[0].name.endsWith('.capnp')) {
    if (files[0].size > 2 * 1024 * 1024) throw new Error('Compiled schema exceeds 2 MiB.');
    const bytes = new Uint8Array(await files[0].arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { schemaBase64: btoa(binary) };
  }
  if (
    files.some((file) => !file.name.endsWith('.capnp')) ||
    files.reduce((size, file) => size + file.size, 0) > 512 * 1024
  )
    throw new Error('Source upload accepts only .capnp files, up to 512 KiB total.');
  const sources = await Promise.all(
    files.map(async (file) => ({
      path: file.webkitRelativePath || file.name,
      source: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
    }))
  );
  return { files: sources, root: sources[0].path };
}
