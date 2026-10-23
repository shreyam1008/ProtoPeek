import { afterEach, expect, it } from 'vitest';
import { toHTTPHistoryEntry } from '@/shared/utils';
import { buildCurlCommand } from './http-curl';
import { parseCurlCommand } from './http-curl-import';
import { encodeHTTPDraft } from './http-draft-store';
import { exportHTTPLibrary, saveHTTPRecipe } from './http-library';

afterEach(() => localStorage.clear());

it('round trips exported quoting, Unicode, newlines, duplicate headers and empty values', () => {
  const input = {
    method: 'POST',
    url: 'https://example.test/?tag=one&tag=two',
    headers: [
      { name: 'X-Owner', value: "O'Brien ☕" },
      { name: 'X-Empty', value: '' },
      { name: 'Content-Type', value: 'text/plain' },
      { name: 'X-Owner', value: 'second' },
    ],
    authHeaderName: null,
    body: "first\nO'Brien ☕",
    timeoutMs: 7250,
    followRedirects: false,
  };
  const exported = buildCurlCommand(input);
  expect(exported.ok).toBe(true);
  if (!exported.ok) return;
  expect(parseCurlCommand(exported.command).draft).toMatchObject({
    method: 'POST',
    url: input.url,
    headers: input.headers,
    body: input.body,
    timeoutSeconds: 7.25,
    rememberBody: false,
  });
});

it('preserves shell literals without evaluating them and accepts long equals/attached short flags', () => {
  const result = parseCurlCommand(
    `curl.exe --url=https://example.test/ -XPOST -H'X-Literal: $HOME; $(echo hi)' --data-raw='@inline' -m2`
  );
  expect(result.draft).toMatchObject({
    method: 'POST',
    headers: [
      { name: 'X-Literal', value: '$HOME; $(echo hi)' },
      { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
    ],
    body: '@inline',
    timeoutSeconds: 2,
  });
});

it.each(['-d', '--data'])('preserves literal CR/LF bytes in inline %s bodies', (option) => {
  const body = 'first\r\nsecond\nthird\rfinal';
  const imported = parseCurlCommand(`curl https://example.test/ ${option} '${body}'`);
  expect(imported.draft.body).toBe(body);
  expect(imported.draft.method).toBe('POST');
  expect(imported.draft.headers).toContainEqual({
    name: 'Content-Type',
    value: 'application/x-www-form-urlencoded',
  });
});

it('imports Basic/Bearer authentication and sensitive headers only into live request state', () => {
  for (const flag of [
    `-u 'name:sentinel-secret'`,
    `-H 'Authorization: Basic ${btoa('name:sentinel-secret')}'`,
  ]) {
    const imported = parseCurlCommand(
      `curl https://example.test/ ${flag} -H 'X-API-Key: sentinel-key'`
    );
    expect(imported.auth).toMatchObject({ mode: 'basic', user: 'name', secret: 'sentinel-secret' });
    expect(imported.credentialCount).toBe(2);
    expect(encodeHTTPDraft(imported.draft)).not.toContain('sentinel');
  }
  expect(
    parseCurlCommand("curl https://example.test -H 'Authorization: Bearer sentinel'").auth
  ).toMatchObject({ mode: 'bearer', secret: 'sentinel' });
});

it.each([
  ['curl https://example.test | cat', /operators/],
  ['curl https://example.test > out', /operators/],
  ['curl "$URL"', /expansion/],
  ['curl https://example.test --data @file', /File/],
  ['curl https://example.test --data-binary @-', /File/],
  ["curl https://example.test -H '@headers.txt'", /file/],
  ["curl https://example.test -H 'Accept:'", /suppression/],
  ["curl 'https://example.test/[1-5]'", /globbing/],
  ['curl https://example.test --config secret', /Unsupported.*--config/],
  ['curl https://example.test --proxy http://proxy', /Unsupported.*--proxy/],
  ['curl https://example.test --insecure', /Unsupported.*--insecure/],
  ['curl https://example.test -L', /Unsupported.*-L/],
  ['curl https://user:sentinel@example.test', /Credentials/],
  ['curl https://example.test https://second.test', /exactly one/],
  ['curl https://example.test -d one -d two', /one inline body/],
  ['curl https://example.test -m NaN', /between/],
  ['curl https://example.test --head=foo', /does not take/],
  ['curl https://example.test -H "X: unfinished', /Close/],
  ['curl https://example.test ^\n -H "X: value"', /bash\/POSIX/],
  ['Invoke-WebRequest https://example.test', /bash\/POSIX/],
  ['curl https://example.test\0', /NUL/],
])('rejects unsupported or unsafe input without guessing: %s', (command, error) => {
  expect(() => parseCurlCommand(command)).toThrow(error);
});

it('applies UTF-8 command size, header and auth ambiguity limits', () => {
  expect(() => parseCurlCommand(`curl https://example.test -d '${'☕'.repeat(180000)}'`)).toThrow(
    /512 KiB/
  );
  expect(() =>
    parseCurlCommand(
      `curl https://example.test ${Array.from({ length: 65 }, () => "-H 'X: a'").join(' ')}`
    )
  ).toThrow(/64 headers/);
  expect(() =>
    parseCurlCommand("curl https://example.test -u 'a:b' -H 'Authorization: Bearer secret'")
  ).toThrow(/one authorization/);
});

it('accepts quoted multiline shell-looking body bytes and literal glob-disabled URLs', () => {
  const input = {
    method: 'POST',
    url: 'https://example.test/',
    headers: [{ name: 'Content-Type', value: 'text/plain' }],
    body: 'caret ^\nbacktick `\n',
    authHeaderName: null,
    timeoutMs: 1000,
    followRedirects: false,
  };
  const exported = buildCurlCommand(input);
  if (!exported.ok) throw new Error(exported.error);
  expect(parseCurlCommand(exported.command).draft.body).toBe(input.body);
  expect(parseCurlCommand("curl --globoff 'https://example.test/[1-5]'").draft.url).toBe(
    'https://example.test/[1-5]'
  );
  expect(parseCurlCommand('curl http://[::1]:8080/').draft.url).toBe('http://[::1]:8080/');
});

// Representative Chromium/Firefox Copy-as-cURL forms with synthetic endpoints/credentials.
it.each([
  String.raw`curl 'https://example.test/graphql' \
    -H 'accept: application/json' -b 'session=sentinel-cookie; preference=light' \
    -H 'content-type: application/json' \
    --data-raw $'{"query":"{user{id}}","variables":{"name":"O\'Brien"},"line":"first\\nsecond"}' --compressed`,
  String.raw`curl 'https://example.test/graphql' --compressed -X POST \
    -H 'Accept: application/json' -H 'Accept-Encoding: gzip, deflate, br' \
    -H 'Cookie: session=sentinel-cookie' --data-raw '{"user":{"id":1}}'`,
])('imports browser-shaped commands without executing or persisting cookies: %s', (command) => {
  const imported = parseCurlCommand(command);
  expect(imported.draft).toMatchObject({ method: 'POST', rememberBody: false });
  expect(
    imported.draft.headers.some((header) => header.name.toLowerCase() === 'accept-encoding')
  ).toBe(false);
  expect(
    imported.draft.headers.find((header) => header.name.toLowerCase() === 'cookie')?.value
  ).toContain('sentinel-cookie');
  expect(imported.credentialCount).toBe(1);
  expect(imported.notices?.join(' ')).toMatch(/negotiates and decodes gzip/);
  expect(() => JSON.parse(imported.draft.body)).not.toThrow();
  expect(encodeHTTPDraft(imported.draft)).not.toContain('sentinel-cookie');
  saveHTTPRecipe('Imported browser request', imported.draft);
  expect(exportHTTPLibrary()).not.toContain('sentinel-cookie');
  expect(
    JSON.stringify(
      toHTTPHistoryEntry({
        method: imported.draft.method,
        url: imported.draft.url,
        requestHeaders: imported.draft.headers,
        status: 'OK',
        statusCode: 200,
        totalMs: 1,
      })
    )
  ).not.toContain('sentinel-cookie');
  const exported = buildCurlCommand({
    method: imported.draft.method,
    url: imported.draft.url,
    headers: imported.draft.headers,
    body: null,
    authHeaderName: null,
    timeoutMs: 1000,
    followRedirects: false,
  });
  expect(JSON.stringify(exported)).not.toContain('sentinel-cookie');
});

it('decodes ANSI-C text, byte escapes and Unicode without expanding shell-looking contents', () => {
  const imported = parseCurlCommand(
    String.raw`curl https://example.test --data-raw $'O\'Brien\n\xE2\x98\x95\040\u03bb\U0001f600 $HOME $(touch nope) \\literal'`
  );
  expect(imported.draft.body).toBe("O'Brien\n☕ λ😀 $HOME $(touch nope) \\literal");
  expect(parseCurlCommand(`curl https://example.test --data-raw $'left'$'right'`).draft.body).toBe(
    'leftright'
  );
});

it.each([
  String.raw`curl https://example.test --data-raw $'\0hidden'`,
  String.raw`curl https://example.test --data-raw $'\x00hidden'`,
  String.raw`curl https://example.test --data-raw $'\xff'`,
  String.raw`curl https://example.test --data-raw $'\uD800'`,
  String.raw`curl https://example.test --data-raw $'\U00110000'`,
  String.raw`curl https://example.test --data-raw $'\x'`,
  `curl https://example.test --data-raw $'unterminated`,
  `curl https://example.test -b '@cookies.txt'`,
  `curl https://example.test --cookie cookies.txt`,
  `curl https://example.test --cookie -`,
  String.raw`curl https://example.test --data $'\x40file'`,
  `curl https://example.test --compressed=yes`,
  String.raw`curl https://example.test -H $'X: safe\r\nInjected: value'`,
  `curl https://example.test -b 'a=b' -H 'Cookie: c=d'`,
  `curl https://example.test -H 'Cookie: c=d' -b 'a=b'`,
])('rejects binary/malformed escapes, cookie files and decoded file references: %s', (command) => {
  expect(() => parseCurlCommand(command)).toThrow();
});

it('preserves a UTF-8 BOM in an ANSI-C quoted request body', () => {
  expect(
    parseCurlCommand(String.raw`curl https://example.test --data-raw $'\xEF\xBB\xBFbody'`).draft
      .body
  ).toBe('\uFEFFbody');
});
