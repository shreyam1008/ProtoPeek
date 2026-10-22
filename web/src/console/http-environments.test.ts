import { afterEach, expect, it, vi } from 'vitest';
import { toHTTPHistoryEntry } from '@/shared/utils';
import { buildCurlCommand } from './http-curl';
import { decodeHTTPDraft, emptyHTTPDraft, encodeHTTPDraft } from './http-draft-store';
import {
  type HTTPEnvironment,
  httpEnvironmentsKey,
  readHTTPEnvironments,
  saveHTTPEnvironments,
} from './http-environments';
import { prepareHTTPExecution } from './http-execution';
import { exportHTTPLibrary, previewHTTPLibraryImport, saveHTTPRecipe } from './http-library';

const profile: HTTPEnvironment = {
  id: 'local',
  name: 'Local',
  variables: [
    { name: 'base_url', value: 'https://example.test', secret: false },
    { name: 'page', value: 'two', secret: false },
    { name: 'credential', value: 'sentinel-session-secret', secret: true },
  ],
};
const auth = { mode: 'none' as const, user: '', secret: '', name: 'X-API-Key' };
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('persists profile choices and ordinary variables while secret values never enter storage', () => {
  const live = saveHTTPEnvironments({ profiles: [profile], selectedId: profile.id });
  expect(live.profiles[0].variables[2].value).toBe('sentinel-session-secret');
  expect(localStorage.getItem(httpEnvironmentsKey)).not.toContain('sentinel-session-secret');
  expect(readHTTPEnvironments()).toMatchObject({
    selectedId: 'local',
    profiles: [{ variables: [{ value: 'https://example.test' }, { value: 'two' }, { value: '' }] }],
    error: '',
  });
});

it('forces credential-like names into session-only storage and clears malicious stored secret values', () => {
  const unsafe = {
    version: 1,
    profiles: [
      { id: 'a', name: 'A', variables: [{ name: 'api_token', value: 'sentinel', secret: false }] },
    ],
    selectedId: 'a',
  };
  localStorage.setItem(httpEnvironmentsKey, JSON.stringify(unsafe));
  expect(readHTTPEnvironments().profiles[0].variables[0]).toEqual({
    name: 'api_token',
    value: '',
    secret: true,
  });
  saveHTTPEnvironments(unsafe);
  expect(localStorage.getItem(httpEnvironmentsKey)).not.toContain('sentinel');
});

it('round trips unresolved URL, body and header references without expanded secrets', () => {
  const draft = {
    ...emptyHTTPDraft(),
    url: '{{base_url}}/items?q={{page}}&literal=pp-template-variable-0',
    headers: [
      { name: 'X-Private', value: '{{credential}}' },
      { name: 'Accept', value: '{{page}}' },
    ],
    rememberBody: true,
    bodyMode: 'json' as const,
    body: '{"page":"{{page}}"}',
  };
  const raw = encodeHTTPDraft(draft);
  expect(raw).not.toContain('sentinel-session-secret');
  expect(raw).not.toBeNull();
  expect(decodeHTTPDraft(raw ?? '')).toEqual(draft);
});

it.each([
  '{{base_url}}',
  '{{base_url}}?q={{page}}',
  '{{base_url}}/../items',
  'https://{{host}}:{{port}}/items?q={{page}}',
])('preserves template URL identity through recovery: %s', (url) => {
  const raw = encodeHTTPDraft({ ...emptyHTTPDraft(), url });
  expect(decodeHTTPDraft(raw ?? '')?.url).toBe(url);
});

it('keeps secret-header provenance out of allowlisted history and cURL export while executing the intended value', () => {
  const prepared = prepareHTTPExecution(
    {
      ...emptyHTTPDraft(),
      url: '{{base_url}}/items',
      headers: [
        { name: 'Accept', value: '{{credential}}' },
        { name: 'X-Custom', value: '{{credential}}' },
      ],
    },
    auth,
    profile
  );
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  expect(prepared.input.headers[0].value).toBe('sentinel-session-secret');
  const history = toHTTPHistoryEntry({
    method: 'GET',
    url: prepared.input.url,
    requestHeaders: prepared.historyHeaders,
    status: 'OK',
    statusCode: 200,
    totalMs: 1,
  });
  const curl = buildCurlCommand({
    ...prepared.exportInput,
    authHeaderName: prepared.authHeaderName,
    body: null,
    preOmittedCredentialCount: prepared.preOmittedCredentialCount,
  });
  expect(JSON.stringify(history)).not.toContain('sentinel-session-secret');
  expect(JSON.stringify(curl)).not.toContain('sentinel-session-secret');
  expect(curl).toMatchObject({ ok: true, omittedCredentialCount: 2 });
});

it('resolves ordinary fields once and live auth after the environment is chosen', () => {
  const prepared = prepareHTTPExecution(
    {
      ...emptyHTTPDraft(),
      url: '{{base_url}}/{{page}}',
      params: [
        { name: 'tag', value: '{{page}}' },
        { name: 'tag', value: 'three' },
      ],
      bodyMode: 'text',
      body: '{{page}}',
      headers: [{ name: 'X-{{page}}', value: '{{page}}' }],
    },
    { ...auth, mode: 'bearer', secret: '{{credential}}' },
    profile
  );
  expect(prepared).toMatchObject({
    ok: true,
    input: {
      url: 'https://example.test/two?tag=two&tag=three',
      body: 'two',
      headers: [
        { name: 'X-two', value: 'two' },
        { name: 'Authorization', value: 'Bearer sentinel-session-secret' },
        { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
      ],
    },
  });
});

it.each([
  { url: 'https://example.test/{{credential}}' },
  { params: [{ name: 'q', value: '{{credential}}' }] },
  { params: [{ name: '{{credential}}', value: 'q' }] },
  { headers: [{ name: '{{credential}}', value: 'value' }] },
  { bodyMode: 'text' as const, body: '{{credential}}' },
])('rejects secret use outside live auth/header values before creating execution data: %j', (change) => {
  const result = prepareHTTPExecution({ ...emptyHTTPDraft(), ...change }, auth, profile);
  expect(result).toEqual({
    ok: false,
    error: 'Secret variable credential is allowed only in Auth and header values.',
  });
});

it('rejects missing variables, nested values and missing restored credentials', () => {
  expect(prepareHTTPExecution({ ...emptyHTTPDraft(), url: '{{base_url}}/' }, auth)).toMatchObject({
    ok: false,
    error: expect.stringContaining('base_url'),
  });
  expect(() =>
    saveHTTPEnvironments({
      selectedId: '',
      profiles: [{ ...profile, variables: [{ name: 'a', value: '{{b}}', secret: false }] }],
    })
  ).toThrow(/other variables/);
  expect(
    prepareHTTPExecution(
      emptyHTTPDraft(),
      { ...auth, mode: 'bearer', secret: '{{credential}}' },
      { ...profile, variables: [{ name: 'credential', value: '', secret: true }] }
    )
  ).toMatchObject({ ok: false, error: expect.stringContaining('Re-enter') });
});

it('enforces duplicate/name/count/value bounds and preserves good profiles on storage failure', () => {
  saveHTTPEnvironments({ profiles: [profile], selectedId: 'local' });
  const before = localStorage.getItem(httpEnvironmentsKey);
  expect(() =>
    saveHTTPEnvironments({
      profiles: [{ ...profile, variables: [...profile.variables, profile.variables[0]] }],
      selectedId: 'local',
    })
  ).toThrow(/unique variable/);
  expect(() =>
    saveHTTPEnvironments({
      profiles: [{ ...profile, variables: [{ name: 'not valid', value: '', secret: false }] }],
      selectedId: 'local',
    })
  ).toThrow(/variable/);
  expect(() =>
    saveHTTPEnvironments({
      profiles: [
        { ...profile, variables: [{ name: 'value', value: '☕'.repeat(3000), secret: false }] },
      ],
      selectedId: 'local',
    })
  ).toThrow(/8 KiB/);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  expect(() => saveHTTPEnvironments({ profiles: [], selectedId: '' })).toThrow('full');
  expect(localStorage.getItem(httpEnvironmentsKey)).toBe(before);
});

it.each([
  '{"user":{"id":1}}',
  '[{"a":{}}]',
  '{user{id}}',
  'literal {{not a reference}} and }}',
])('preserves literal braces in request bodies without an environment: %s', (body) => {
  const prepared = prepareHTTPExecution({ ...emptyHTTPDraft(), bodyMode: 'text', body }, auth);
  expect(prepared).toMatchObject({ ok: true, input: { body } });
});

it('expands only recognized references while preserving nested JSON, GraphQL and literal auth braces', () => {
  const body = '{"user":{"page":"{{page}}","query":"{user{id}}"}}';
  const prepared = prepareHTTPExecution(
    { ...emptyHTTPDraft(), bodyMode: 'json', body },
    { ...auth, mode: 'bearer', secret: 'literal}}token' },
    profile
  );
  expect(prepared).toMatchObject({
    ok: true,
    input: {
      body: '{"user":{"page":"two","query":"{user{id}}"}}',
      headers: [
        { name: 'Authorization', value: 'Bearer literal}}token' },
        { name: 'Content-Type', value: 'application/json' },
      ],
    },
  });
  const saved = saveHTTPEnvironments({
    profiles: [
      {
        id: 'json',
        name: 'JSON',
        variables: [{ name: 'object', value: '{"a":{"b":1}}', secret: false }],
      },
    ],
    selectedId: 'json',
  });
  expect(
    prepareHTTPExecution(
      { ...emptyHTTPDraft(), bodyMode: 'json', body: '{{object}}' },
      auth,
      saved.profiles[0]
    )
  ).toMatchObject({ ok: true, input: { body: '{"a":{"b":1}}' } });
});

it('rejects nested recognized references even in an unsaved live environment', () => {
  expect(
    prepareHTTPExecution({ ...emptyHTTPDraft(), bodyMode: 'text', body: '{{outer}}' }, auth, {
      id: 'nested',
      name: 'Nested',
      variables: [{ name: 'outer', value: '{{inner}}', secret: false }],
    })
  ).toMatchObject({ ok: false, error: expect.stringContaining('other variables') });
});

it('round trips more than ten distinct template markers through drafts, saved recipes and library export', () => {
  const url = `https://{{host}}:{{port}}/${Array.from({ length: 14 }, (_, index) => `{{path${index}}}`).join('/')}?first={{query0}}&second={{query1}}`;
  const draft = { ...emptyHTTPDraft(), url };
  const raw = encodeHTTPDraft(draft);
  expect(decodeHTTPDraft(raw ?? '')?.url).toBe(url);
  const saved = saveHTTPRecipe('Many references', draft);
  expect(saved[0].draft.url).toBe(url);
  const imported = previewHTTPLibraryImport(exportHTTPLibrary());
  expect(imported.requests[0].draft.url).toBe(url);
});

it('retains header references by row when sanitizers redact non-sensitive and credential fields', () => {
  const headers = [
    { name: 'X-Custom', value: 'private-literal' },
    { name: 'Authorization', value: 'Bearer {{credential}}' },
    { name: 'Accept', value: '{{page}}' },
    { name: 'X-Custom', value: '{{page}}' },
  ];
  const raw = encodeHTTPDraft({ ...emptyHTTPDraft(), headers });
  expect(raw).not.toContain('private-literal');
  expect(decodeHTTPDraft(raw ?? '')?.headers).toEqual([
    { name: 'X-Custom', value: '' },
    headers[1],
    headers[2],
    headers[3],
  ]);
});
