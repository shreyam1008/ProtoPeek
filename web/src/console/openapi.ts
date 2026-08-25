import type { MetadataEntry } from '@/shared/types';

const operationMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
const maxDocumentBytes = 2 * 1024 * 1024;
const maxOperations = 1_000;
const encoder = new TextEncoder();

type UnknownRecord = Record<string, unknown>;

export type OpenAPIOperation = {
  id: string;
  tag: string;
  method: string;
  path: string;
  summary: string;
  url: string;
  query: MetadataEntry[];
  headers: MetadataEntry[];
  body: string | null;
};

export type OpenAPICollection = {
  title: string;
  version: string;
  source: string;
  baseURL: string;
  operations: OpenAPIOperation[];
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstRecord(value: unknown) {
  return Array.isArray(value) ? record(value[0]) : null;
}

function localReference(root: UnknownRecord, value: unknown, seen = new Set<string>()) {
  let current = record(value);
  while (current && text(current.$ref).startsWith('#/')) {
    const reference = text(current.$ref);
    if (seen.has(reference)) return current;
    seen.add(reference);
    let resolved: unknown = root;
    for (const segment of reference.slice(2).split('/')) {
      resolved = record(resolved)?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
    }
    current = record(resolved);
  }
  return current;
}

function exampleFromSchema(
  root: UnknownRecord,
  schemaValue: unknown,
  depth = 0,
  seen = new Set<string>()
): unknown {
  if (depth > 6) return null;
  const initial = record(schemaValue);
  const reference = text(initial?.$ref);
  if (reference && seen.has(reference)) return null;
  const nextSeen = new Set(seen);
  if (reference) nextSeen.add(reference);
  const schema = localReference(root, initial, seen);
  if (!schema) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const union = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : null;
  if (union?.length) return exampleFromSchema(root, union[0], depth + 1, nextSeen);

  const type = text(schema.type);
  const properties = record(schema.properties);
  if (type === 'object' || properties) {
    const result: UnknownRecord = {};
    for (const [name, property] of Object.entries(properties ?? {})) {
      result[name] = exampleFromSchema(root, property, depth + 1, nextSeen);
    }
    return result;
  }
  if (type === 'array') {
    return [exampleFromSchema(root, schema.items, depth + 1, nextSeen)];
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (text(schema.format) === 'date-time') return '2026-01-01T00:00:00Z';
  if (text(schema.format) === 'date') return '2026-01-01';
  if (text(schema.format) === 'uuid') return '00000000-0000-4000-8000-000000000000';
  return '';
}

function parameterValue(root: UnknownRecord, parameter: UnknownRecord) {
  if (parameter.example !== undefined) return String(parameter.example);
  const schema = localReference(root, parameter.schema);
  const value =
    schema?.example ?? schema?.default ?? (Array.isArray(schema?.enum) ? schema?.enum[0] : '');
  return value === undefined || value === null ? '' : String(value);
}

function resolveServerURL(serverValue: unknown, sourceURL: string) {
  const server = record(serverValue);
  let url = text(server?.url);
  const variables = record(server?.variables);
  url = url.replaceAll(/\{([^}]+)\}/g, (_match, name: string) => {
    const variable = record(variables?.[name]);
    return text(variable?.default) || `{${name}}`;
  });
  if (!url) return '';
  try {
    return new URL(url, sourceURL || 'http://localhost:8080/').toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function swaggerBaseURL(document: UnknownRecord, sourceURL: string) {
  const host = text(document.host);
  const scheme = Array.isArray(document.schemes) ? text(document.schemes[0]) : '';
  const basePath = text(document.basePath);
  if (host) return `${scheme || 'https'}://${host}${basePath}`.replace(/\/$/, '');
  try {
    return `${new URL(sourceURL).origin}${basePath}`.replace(/\/$/, '');
  } catch {
    return `http://localhost:8080${basePath}`.replace(/\/$/, '');
  }
}

function operationBody(root: UnknownRecord, operation: UnknownRecord, parameters: UnknownRecord[]) {
  const requestBody = localReference(root, operation.requestBody);
  const content = record(requestBody?.content);
  const media = record(content?.['application/json']) ?? firstRecord(Object.values(content ?? {}));
  if (media) {
    const examples = record(media.examples);
    const firstExample = firstRecord(Object.values(examples ?? {}));
    const value = media.example ?? firstExample?.value ?? exampleFromSchema(root, media.schema);
    return value === undefined ? null : JSON.stringify(value, null, 2);
  }
  const bodyParameter = parameters.find((parameter) => text(parameter.in) === 'body');
  if (!bodyParameter) return null;
  return JSON.stringify(exampleFromSchema(root, bodyParameter.schema), null, 2);
}

function joinOperationURL(baseURL: string, path: string) {
  const base = baseURL || 'http://localhost:8080';
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export function parseOpenAPIText(sourceText: string, source = 'Imported file'): OpenAPICollection {
  if (encoder.encode(sourceText).length > maxDocumentBytes) {
    throw new Error('OpenAPI document exceeds the 2 MiB import limit.');
  }
  let value: unknown;
  try {
    value = JSON.parse(sourceText);
  } catch {
    throw new Error(
      'ProtoPeek currently imports OpenAPI or Swagger JSON. Use the direct JSON definition URL or export JSON from the docs page.'
    );
  }
  const document = record(value);
  if (!document) throw new Error('OpenAPI document must be a JSON object.');
  const openAPIVersion = text(document.openapi);
  const swaggerVersion = text(document.swagger);
  if (!openAPIVersion.startsWith('3.') && swaggerVersion !== '2.0') {
    throw new Error('Expected OpenAPI 3.x or Swagger 2.0 JSON.');
  }
  const sourceURL = /^https?:\/\//i.test(source) ? source : '';
  const rootServer = firstRecord(document.servers);
  const baseURL = openAPIVersion
    ? resolveServerURL(rootServer, sourceURL)
    : swaggerBaseURL(document, sourceURL);
  const info = record(document.info);
  const paths = record(document.paths);
  if (!paths) throw new Error('OpenAPI document does not define any paths.');

  const operations: OpenAPIOperation[] = [];
  for (const [path, pathValue] of Object.entries(paths)) {
    const pathItem = record(pathValue);
    if (!pathItem || !path.startsWith('/')) continue;
    const pathParameters = Array.isArray(pathItem.parameters)
      ? pathItem.parameters.map((entry) => localReference(document, entry)).filter(Boolean)
      : [];
    for (const methodName of operationMethods) {
      const operation = record(pathItem[methodName]);
      if (!operation) continue;
      if (operations.length >= maxOperations) {
        throw new Error(
          `OpenAPI document exceeds the ${maxOperations.toLocaleString()} operation limit.`
        );
      }
      const ownParameters = Array.isArray(operation.parameters)
        ? operation.parameters.map((entry) => localReference(document, entry)).filter(Boolean)
        : [];
      const parameters = [...pathParameters, ...ownParameters] as UnknownRecord[];
      let resolvedPath = path;
      const query: MetadataEntry[] = [];
      const headers: MetadataEntry[] = [];
      for (const parameter of parameters) {
        const name = text(parameter.name);
        if (!name) continue;
        const location = text(parameter.in);
        const parameterExample = parameterValue(document, parameter);
        if (location === 'path') {
          resolvedPath = resolvedPath.replaceAll(`{${name}}`, parameterExample || `{${name}}`);
        } else if (location === 'query') {
          query.push({ name, value: parameterExample });
        } else if (location === 'header') {
          headers.push({ name, value: parameterExample });
        }
      }
      const tags = Array.isArray(operation.tags) ? operation.tags.map(text).filter(Boolean) : [];
      const operationServer = firstRecord(operation.servers) ?? firstRecord(pathItem.servers);
      const operationBaseURL = openAPIVersion
        ? resolveServerURL(operationServer ?? rootServer, sourceURL) || baseURL
        : baseURL;
      const summary =
        text(operation.summary) ||
        text(operation.operationId) ||
        `${methodName.toUpperCase()} ${path}`;
      operations.push({
        id: text(operation.operationId) || `${methodName}:${path}`,
        tag: tags[0] || 'Ungrouped',
        method: methodName.toUpperCase(),
        path,
        summary,
        url: joinOperationURL(operationBaseURL, resolvedPath),
        query,
        headers,
        body: operationBody(document, operation, parameters),
      });
    }
  }
  if (!operations.length)
    throw new Error('OpenAPI document contains no supported HTTP operations.');
  return {
    title: text(info?.title) || 'Imported API',
    version: text(info?.version) || openAPIVersion || swaggerVersion,
    source,
    baseURL: baseURL || 'http://localhost:8080',
    operations,
  };
}

export function discoverOpenAPISpecURL(html: string, pageURL: string) {
  const patterns = [
    /data-url=["']([^"']+)["']/i,
    /(?:spec\s*:\s*\{[^}]*|SwaggerUIBundle\s*\(\s*\{[^}]*|apiReference\s*\(\s*\{[^}]*)url\s*:\s*["']([^"']+)["']/is,
    /["'](?:specUrl|openapiUrl|definitionUrl)["']\s*:\s*["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const candidate = pattern.exec(html)?.[1];
    if (!candidate) continue;
    try {
      const resolved = new URL(candidate, pageURL);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:')
        return resolved.toString();
    } catch {
      // Try the next known docs-page pattern.
    }
  }
  return null;
}
