import type { HTTPRequestInput, MetadataEntry } from '@/shared/types';
import { prepareURLForReplay } from '@/shared/utils';

export const httpRequestDraftLimits = {
  bodyBytes: 1024 * 1024,
  headers: 128,
  headerNameBytes: 256,
  headerValueBytes: 16 * 1024,
  minTimeoutMs: 100,
  maxTimeoutMs: 120_000,
} as const;

export type HTTPRequestDraft = {
  method: string;
  url: string;
  headers: MetadataEntry[];
  body: string | null;
  timeoutMs: number;
  followRedirects: boolean;
};

export type PreparedHTTPRequestDraft =
  | {
      ok: true;
      input: HTTPRequestInput;
      bodyActive: boolean;
      redactedQueryCount: number;
    }
  | { ok: false; error: string };

const utf8Encoder = new TextEncoder();
const httpToken = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const validHost = /^[0-9A-Za-z!$%&()*+,\-.:;='[\]_~]+$/;

function hasInvalidHeaderValue(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code <= 31 && code !== 9) || code === 127) return true;
  }
  return false;
}

export function prepareHTTPRequestDraft(draft: HTTPRequestDraft): PreparedHTTPRequestDraft {
  const method = draft.method.trim().toUpperCase();
  if (!httpToken.test(method)) {
    return { ok: false, error: 'Choose a valid HTTP method before sending or copying.' };
  }
  if (
    !Number.isSafeInteger(draft.timeoutMs) ||
    draft.timeoutMs < httpRequestDraftLimits.minTimeoutMs ||
    draft.timeoutMs > httpRequestDraftLimits.maxTimeoutMs
  ) {
    return { ok: false, error: 'Set the timeout between 0.1 and 120 seconds.' };
  }
  if (draft.headers.length > httpRequestDraftLimits.headers) {
    return {
      ok: false,
      error: `HTTP requests support at most ${httpRequestDraftLimits.headers} headers.`,
    };
  }

  let parsedURL: URL;
  try {
    parsedURL = new URL(draft.url.trim());
    if (
      (parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:') ||
      parsedURL.host === ''
    ) {
      throw new Error();
    }
  } catch {
    return { ok: false, error: 'Enter an absolute http:// or https:// URL.' };
  }
  if (parsedURL.username || parsedURL.password) {
    return {
      ok: false,
      error: 'Credentials are not allowed in URLs; use the Auth or Headers tab.',
    };
  }
  const preparedURL = prepareURLForReplay(parsedURL.toString());

  const headers: MetadataEntry[] = [];
  for (const header of draft.headers) {
    const name = header.name.trim();
    if (name === '') continue;
    if (
      !httpToken.test(name) ||
      utf8Encoder.encode(name).length > httpRequestDraftLimits.headerNameBytes
    ) {
      return {
        ok: false,
        error: `Invalid HTTP header name; names must be HTTP tokens no larger than ${httpRequestDraftLimits.headerNameBytes} bytes.`,
      };
    }
    if (hasInvalidHeaderValue(header.value)) {
      return {
        ok: false,
        error: `Invalid HTTP header ${JSON.stringify(name)}; values cannot contain control characters.`,
      };
    }
    if (utf8Encoder.encode(header.value).length > httpRequestDraftLimits.headerValueBytes) {
      return {
        ok: false,
        error: `HTTP header value exceeds the ${httpRequestDraftLimits.headerValueBytes / 1024} KiB limit.`,
      };
    }
    const value = name.toLowerCase() === 'host' ? header.value.trim() : header.value;
    if (name.toLowerCase() === 'host' && !validHost.test(value)) {
      return { ok: false, error: 'Invalid HTTP Host header.' };
    }
    headers.push({ name, value });
  }

  const body = draft.body ?? '';
  if (utf8Encoder.encode(body).length > httpRequestDraftLimits.bodyBytes) {
    return { ok: false, error: 'HTTP request body exceeds 1 MiB.' };
  }

  return {
    ok: true,
    input: {
      method,
      url: preparedURL.url,
      headers,
      body,
      timeoutMs: draft.timeoutMs,
      followRedirects: draft.followRedirects,
    },
    bodyActive: draft.body !== null,
    redactedQueryCount: preparedURL.redactedCount,
  };
}
