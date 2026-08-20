import type { MetadataEntry } from '@/shared/types';
import {
  isRedactedValue,
  isSensitiveMetadataName,
  sanitizeURLForPersistence,
} from '@/shared/utils';

import { prepareHTTPRequestDraft } from './http-request-draft';

export interface CurlRequestDraft {
  method: string;
  url: string;
  headers: MetadataEntry[];
  authHeaderName: string | null;
  body: string | null;
  timeoutMs: number;
  followRedirects: boolean;
  preOmittedCredentialCount?: number;
}

export interface CurlExportLimits {
  commandBytes: number;
  headers: number;
}

export const curlExportLimits: CurlExportLimits = {
  commandBytes: 512 * 1024,
  headers: 64,
};

const utf8Encoder = new TextEncoder();

export type CurlCommandResult =
  | {
      ok: true;
      command: string;
      omittedCredentialCount: number;
      bodyCopiedVerbatim: boolean;
    }
  | { ok: false; error: string };

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildCurlCommand(
  input: CurlRequestDraft,
  limits: CurlExportLimits = curlExportLimits
): CurlCommandResult {
  const prepared = prepareHTTPRequestDraft({
    method: input.method,
    url: input.url,
    headers: input.headers,
    body: input.body,
    timeoutMs: input.timeoutMs,
    followRedirects: input.followRedirects,
  });
  if (!prepared.ok) return prepared;
  if (input.followRedirects) {
    return {
      ok: false,
      error:
        "Turn off Follow redirects before copying cURL. One portable command cannot reproduce ProtoPeek's bounded redirect, method, header, and HTTPS downgrade policy.",
    };
  }
  if (prepared.input.headers.length > limits.headers) {
    return {
      ok: false,
      error: `cURL export supports at most ${limits.headers} request headers. Remove a header and try again.`,
    };
  }
  const parsedURL = new URL(prepared.input.url);
  let omittedCredentialCount = (input.preOmittedCredentialCount ?? 0) + prepared.redactedQueryCount;
  const originalQuery = [...parsedURL.searchParams];
  const sanitizedURL = new URL(sanitizeURLForPersistence(parsedURL.toString()));
  const sanitizedQuery = new URLSearchParams();
  let queryIndex = 0;
  for (const [name, value] of sanitizedURL.searchParams) {
    if (isRedactedValue(value)) {
      sanitizedQuery.append(name, '');
      const originalValue = originalQuery[queryIndex]?.[1] ?? '';
      if (originalValue !== '' || isRedactedValue(originalValue)) omittedCredentialCount++;
    } else {
      sanitizedQuery.append(name, value);
    }
    queryIndex++;
  }
  sanitizedURL.search = sanitizedQuery.toString();
  const authHeaderName = input.authHeaderName?.trim().toLowerCase() ?? null;
  const exportedHeaders = prepared.input.headers.filter((header) => {
    const omitted =
      isSensitiveMetadataName(header.name) ||
      isRedactedValue(header.value) ||
      (authHeaderName !== null && header.name.trim().toLowerCase() === authHeaderName);
    if (omitted) omittedCredentialCount++;
    return !omitted;
  });
  if (
    prepared.input.method.includes('\0') ||
    prepared.input.body.includes('\0') ||
    exportedHeaders.some((header) => header.name.includes('\0') || header.value.includes('\0'))
  ) {
    return {
      ok: false,
      error:
        'cURL export cannot represent NUL bytes in POSIX shell arguments. Remove the NUL character and try again.',
    };
  }
  const parts = [
    'curl',
    `  --request ${shellQuote(prepared.input.method)}`,
    `  --url ${shellQuote(sanitizedURL.toString())}`,
    ...exportedHeaders.map(
      (header) =>
        `  --header ${shellQuote(header.value === '' ? `${header.name};` : `${header.name}: ${header.value}`)}`
    ),
    `  --max-time ${shellQuote(String(prepared.input.timeoutMs / 1000))}`,
  ];
  if (prepared.bodyActive) parts.push(`  --data-raw ${shellQuote(prepared.input.body)}`);
  const command = parts.join(' \\\n');
  if (utf8Encoder.encode(command).length > limits.commandBytes) {
    const limitLabel =
      limits.commandBytes % 1024 === 0
        ? `${limits.commandBytes / 1024} KiB`
        : `${limits.commandBytes} bytes`;
    return {
      ok: false,
      error: `cURL command exceeds ${limitLabel}. Shorten the URL, headers, or body and try again.`,
    };
  }

  return {
    ok: true,
    command,
    omittedCredentialCount,
    bodyCopiedVerbatim: prepared.bodyActive,
  };
}
