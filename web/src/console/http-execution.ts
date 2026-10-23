import { filterMetadataForInvoke, isRedactedValue } from '@/shared/utils';
import type { HTTPDraft } from './http-draft-store';
import { type HTTPEnvironment, resolveHTTPTemplate } from './http-environments';
import { normalizeHTTPDraftURL, prepareHTTPRequestDraft } from './http-request-draft';

export type HTTPAuth = {
  mode: 'none' | 'basic' | 'bearer' | 'api-key';
  user: string;
  secret: string;
  name: string;
};

export function prepareHTTPExecution(
  draft: HTTPDraft,
  auth: HTTPAuth,
  environment: HTTPEnvironment | null = null
) {
  try {
    const { draft: resolved, resolve, secretHeaders } = resolveHTTPTemplate(draft, environment);
    const normalized = normalizeHTTPDraftURL(resolved.url);
    if (!normalized.ok) return normalized;
    const url = new URL(normalized.url);
    for (const param of resolved.params)
      if (param.name.trim()) url.searchParams.append(param.name.trim(), param.value);
    const headers = filterMetadataForInvoke(resolved.headers).map((header) => ({ ...header }));
    const secret = auth.mode === 'none' ? '' : resolve(auth.secret, true).text;
    const user = auth.mode === 'basic' ? resolve(auth.user, true).text : '';
    const authPlaceholderOmitted = auth.mode !== 'none' && isRedactedValue(secret);
    const usableSecret = authPlaceholderOmitted ? '' : secret;
    let authHeaderName: string | null = null;
    if (auth.mode === 'bearer' && usableSecret) {
      headers.push({ name: 'Authorization', value: `Bearer ${usableSecret}` });
      authHeaderName = 'Authorization';
    } else if (auth.mode === 'basic' && !authPlaceholderOmitted && (user || usableSecret)) {
      const bytes = new TextEncoder().encode(`${user}:${usableSecret}`);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      headers.push({ name: 'Authorization', value: `Basic ${btoa(binary)}` });
      authHeaderName = 'Authorization';
    } else if (auth.mode === 'api-key' && usableSecret) {
      const name = resolve(auth.name).text.trim();
      if (name) {
        headers.push({ name, value: usableSecret });
        authHeaderName = name;
      }
    }
    if (
      resolved.bodyMode !== 'none' &&
      !headers.some((header) => header.name.trim().toLowerCase() === 'content-type')
    )
      headers.push({
        name: 'Content-Type',
        value: resolved.bodyMode === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
      });
    const prepared = prepareHTTPRequestDraft({
      method: resolved.method,
      url: url.toString(),
      headers,
      body: resolved.bodyMode === 'none' ? null : resolved.body,
      timeoutMs: Math.round(resolved.timeoutSeconds * 1000),
      followRedirects: resolved.followRedirects,
    });
    if (!prepared.ok) return prepared;
    if (authHeaderName) secretHeaders.add(authHeaderName.toLowerCase());
    const exportHeaders = prepared.input.headers.filter(
      (header) => !secretHeaders.has(header.name.toLowerCase())
    );
    return {
      ...prepared,
      authHeaderName,
      authPlaceholderOmitted,
      historyHeaders: prepared.input.headers.map((header) => ({
        ...header,
        value: secretHeaders.has(header.name.toLowerCase()) ? '[redacted]' : header.value,
      })),
      exportInput: { ...prepared.input, headers: exportHeaders },
      preOmittedCredentialCount:
        resolved.headers.filter((header) => header.name.trim() && isRedactedValue(header.value))
          .length +
        Number(authPlaceholderOmitted) +
        prepared.redactedQueryCount +
        prepared.input.headers.length -
        exportHeaders.length,
    };
  } catch (cause) {
    return {
      ok: false as const,
      error: cause instanceof Error ? cause.message : 'The request template could not be resolved.',
    };
  }
}
