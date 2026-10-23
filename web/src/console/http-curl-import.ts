import { isSensitiveMetadataName } from '@/shared/utils';
import { emptyHTTPDraft, type HTTPDraft, httpMethods } from './http-draft-store';
import { type HTTPAuth, prepareHTTPExecution } from './http-execution';

export type ImportedHTTPRequest = {
  draft: HTTPDraft;
  auth: HTTPAuth;
  credentialCount: number;
  notices?: string[];
};
const shellNotice = 'Use Copy as cURL (bash/POSIX). cmd and PowerShell quoting are unsupported.';

// Decode the supported Bash ANSI-C quoting subset as bytes, never through a shell.
// Byte escapes must form UTF-8 because the HTTP editor has no binary request body mode.
function ansiQuoted(command: string, start: number) {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const append = (text: string) => {
    for (const byte of encoder.encode(text)) bytes.push(byte);
  };
  const escapes: Record<string, string> = {
    a: '\x07',
    b: '\b',
    e: '\x1b',
    E: '\x1b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
    '\\': '\\',
    "'": "'",
    '"': '"',
    '?': '?',
  };
  let literal = '';
  for (let index = start + 2; index < command.length; index++) {
    const char = command[index];
    if (char === "'") {
      append(literal);
      try {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          Uint8Array.from(bytes)
        );
        if (text.includes('\0')) throw new Error();
        return { text, end: index };
      } catch {
        throw new Error('ANSI-C quoted bytes must be UTF-8 text without NUL.');
      }
    }
    if (char !== '\\') {
      literal += char;
      continue;
    }
    append(literal);
    literal = '';
    const code = command[++index];
    if (code === undefined) break;
    if (Object.hasOwn(escapes, code)) {
      append(escapes[code]);
      continue;
    }
    const octal = /^[0-7]$/.test(code);
    if (octal || ['x', 'u', 'U'].includes(code)) {
      const length = octal ? 3 : code === 'x' ? 2 : code === 'u' ? 4 : 8;
      const remaining = command.slice(octal ? index : index + 1);
      const digits = (octal ? /^[0-7]+/ : /^[0-9a-fA-F]+/).exec(remaining)?.[0].slice(0, length);
      if (!digits) throw new Error('ANSI-C numeric escapes need digits.');
      index += digits.length - Number(octal);
      const value = Number.parseInt(digits, octal ? 8 : 16);
      if (octal || code === 'x') bytes.push(value & 255);
      else {
        if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff))
          throw new Error('ANSI-C Unicode escapes need a valid Unicode scalar.');
        append(String.fromCodePoint(value));
      }
      continue;
    }
    throw new Error(`Unsupported ANSI-C escape ${code}; paste literal UTF-8 text.`);
  }
  throw new Error('Close the ANSI-C quoted value in the cURL command.');
}

function tokenize(command: string) {
  if (new TextEncoder().encode(command).length > 512 * 1024)
    throw new Error('cURL import is limited to 512 KiB.');
  if (command.includes('\0')) throw new Error('cURL commands cannot contain NUL bytes.');
  if (/^\s*(?:Invoke-WebRequest|iwr|\$|&\s*curl)/i.test(command)) throw new Error(shellNotice);
  const tokens: string[] = [];
  let token = '';
  let started = false;
  let quote = '';
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = '';
      else token += char;
      continue;
    }
    if (
      !quote &&
      ((char === '^' && /^\s*\r?\n/.test(command.slice(index + 1))) ||
        (char === '`' && /^[\r\n]/.test(command.slice(index + 1))))
    )
      throw new Error(shellNotice);
    if (char === '\\') {
      const next = command[++index];
      if (next === undefined) throw new Error('The cURL command ends with an unfinished escape.');
      if (next === '\n') continue;
      if (next === '\r' && command[index + 1] === '\n') {
        index++;
        continue;
      }
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) token += '\\';
      token += next;
      started = true;
      continue;
    }
    if (!quote && char === '$' && command[index + 1] === "'") {
      const quoted = ansiQuoted(command, index);
      token += quoted.text;
      index = quoted.end;
      started = true;
      continue;
    }
    if (char === '$' || char === '`')
      throw new Error('Shell expansion is unsupported; paste literal quoted values.');
    if (quote === '"') {
      if (char === '"') quote = '';
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (/[;&|<>()]/.test(char))
      throw new Error('Shell operators, redirection and additional commands are unsupported.');
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(token);
        token = '';
        started = false;
      }
    } else {
      if (char === '#' && !started) throw new Error('Shell comments are unsupported.');
      token += char;
      started = true;
    }
    if (tokens.length > 257) throw new Error('cURL import supports at most 256 arguments.');
  }
  if (quote) throw new Error('Close the quoted value in the cURL command.');
  if (started) tokens.push(token);
  if (!/^curl(?:\.exe)?$/i.test(tokens.shift() ?? ''))
    throw new Error(`Start with curl. ${shellNotice}`);
  if (tokens.length > 256) throw new Error('cURL import supports at most 256 arguments.');
  return tokens;
}

export function parseCurlCommand(command: string): ImportedHTTPRequest {
  const args = tokenize(command);
  const draft = emptyHTTPDraft();
  draft.url = '';
  const auth: HTTPAuth = { mode: 'none', user: '', secret: '', name: 'X-API-Key' };
  let explicitMethod = '';
  let head = false;
  let body: string | null = null;
  let bodyOption = '';
  let credentials = 0;
  let endedOptions = false;
  let globOff = false;
  let compressed = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!endedOptions && argument === '--') {
      endedOptions = true;
      continue;
    }
    if (endedOptions || !argument.startsWith('-')) {
      if (draft.url) throw new Error('Import exactly one HTTP(S) URL.');
      draft.url = argument;
      continue;
    }
    const equal = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const attached =
      !argument.startsWith('--') && /^-[XHduAmb]/.test(argument) && argument.length > 2;
    const option =
      equal > 0 ? argument.slice(0, equal) : attached ? argument.slice(0, 2) : argument;
    const value = () => {
      const result =
        equal > 0 ? argument.slice(equal + 1) : attached ? argument.slice(2) : args[++index];
      if (result === undefined) throw new Error(`Give ${option} a value.`);
      return result;
    };
    if (
      ['-s', '-S', '--silent', '--show-error', '-g', '--globoff', '--compressed'].includes(option)
    ) {
      if (equal > 0) throw new Error(`${option} does not take a value.`);
      if (option === '-g' || option === '--globoff') globOff = true;
      if (option === '--compressed') compressed = true;
    } else if (option === '--url') {
      if (draft.url) throw new Error('Import exactly one HTTP(S) URL.');
      draft.url = value();
    } else if (option === '-X' || option === '--request') explicitMethod = value().toUpperCase();
    else if (option === '-I' || option === '--head') {
      if (equal > 0) throw new Error(`${option} does not take a value.`);
      head = true;
    } else if (['-H', '--header', '-A', '--user-agent'].includes(option)) {
      const header =
        option === '-A' || option === '--user-agent' ? `User-Agent: ${value()}` : value();
      if (header.startsWith('@')) throw new Error('Header file and stdin reads are unsupported.');
      const colon = header.indexOf(':');
      if (colon < 1 && !header.endsWith(';'))
        throw new Error('Headers need Name: value or Name; for an empty value.');
      if (colon > 0 && !header.slice(colon + 1).trim())
        throw new Error(
          'cURL header suppression (Name:) is unsupported; use Name; for an explicit empty value.'
        );
      draft.headers.push({
        name: colon > 0 ? header.slice(0, colon).trim() : header.slice(0, -1).trim(),
        value: colon > 0 ? header.slice(colon + 1).replace(/^\s+/, '') : '',
      });
    } else if (option === '-b' || option === '--cookie') {
      const cookie = value();
      if (cookie.startsWith('@') || !cookie.includes('='))
        throw new Error(
          'Cookie files and stdin reads are unsupported; paste literal name=value cookies.'
        );
      if (draft.headers.some((header) => header.name.toLowerCase() === 'cookie'))
        throw new Error('Import one Cookie header or literal cookie option.');
      draft.headers.push({ name: 'Cookie', value: cookie });
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--json'].includes(option)) {
      if (body !== null)
        throw new Error('Import one inline body; combine repeated data options first.');
      body = value();
      bodyOption = option;
      if (option !== '--data-raw' && body.startsWith('@'))
        throw new Error('File and stdin reads are unsupported; paste an inline body.');
    } else if (option === '-m' || option === '--max-time') {
      const seconds = Number(value());
      if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 120)
        throw new Error('Set --max-time between 0.1 and 120 seconds.');
      draft.timeoutSeconds = seconds;
    } else if (option === '-u' || option === '--user') {
      const credential = value();
      const colon = credential.indexOf(':');
      if (colon < 0)
        throw new Error(
          'Basic auth needs an explicit username:password; interactive prompts are unsupported.'
        );
      if (auth.mode !== 'none') throw new Error('Import only one authorization choice.');
      auth.mode = 'basic';
      auth.user = credential.slice(0, colon);
      auth.secret = credential.slice(colon + 1);
      credentials++;
    } else {
      throw new Error(
        `Unsupported cURL option ${option}. Files, proxies, redirects, insecure TLS and shell behavior are not imported.`
      );
    }
  }
  if (!/^https?:\/\//i.test(draft.url))
    throw new Error('Use one absolute http:// or https:// URL.');
  if (!globOff && /[{}[\]]/.test(draft.url.replace(/^https?:\/\/\[[^\]]+\]/i, 'http://ipv6')))
    throw new Error('URL globbing is unsupported; use --globoff for literal brackets or braces.');
  draft.method = explicitMethod || (head ? 'HEAD' : body === null ? 'GET' : 'POST');
  if (!httpMethods.includes(draft.method))
    throw new Error('This method is not supported by the HTTP editor.');
  if (head && (body !== null || draft.method !== 'HEAD'))
    throw new Error('Do not combine --head with a body or a different method.');
  if (draft.headers.length > 64) throw new Error('cURL import supports at most 64 headers.');
  if (draft.headers.filter((header) => header.name.toLowerCase() === 'cookie').length > 1)
    throw new Error('Import one Cookie header or literal cookie option.');
  const authorization = draft.headers.filter(
    (header) => header.name.toLowerCase() === 'authorization'
  );
  if (authorization.length > 1 || (authorization.length && auth.mode !== 'none'))
    throw new Error('Import only one authorization choice.');
  if (authorization.length === 1 && /^Bearer\s+/i.test(authorization[0].value)) {
    auth.mode = 'bearer';
    auth.secret = authorization[0].value.replace(/^Bearer\s+/i, '');
    draft.headers = draft.headers.filter((header) => header !== authorization[0]);
    credentials++;
  } else if (authorization.length === 1 && /^Basic\s+/i.test(authorization[0].value)) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(atob(authorization[0].value.replace(/^Basic\s+/i, '')), (char) =>
          char.charCodeAt(0)
        )
      );
      const colon = decoded.indexOf(':');
      if (colon < 0) throw new Error();
      auth.mode = 'basic';
      auth.user = decoded.slice(0, colon);
      auth.secret = decoded.slice(colon + 1);
      draft.headers = draft.headers.filter((header) => header !== authorization[0]);
      credentials++;
    } catch {
      throw new Error('The Basic authorization header is invalid.');
    }
  }
  credentials += draft.headers.filter((header) => isSensitiveMetadataName(header.name)).length;
  if (body !== null) {
    draft.bodyMode = bodyOption === '--json' ? 'json' : 'text';
    draft.body = body;
    if (!draft.headers.some((header) => header.name.toLowerCase() === 'content-type'))
      draft.headers.push({
        name: 'Content-Type',
        value: bodyOption === '--json' ? 'application/json' : 'application/x-www-form-urlencoded',
      });
    if (
      bodyOption === '--json' &&
      !draft.headers.some((header) => header.name.toLowerCase() === 'accept')
    )
      draft.headers.push({ name: 'Accept', value: 'application/json' });
  }
  const notices: string[] = [];
  if (
    compressed ||
    draft.headers.some((header) => header.name.toLowerCase() === 'accept-encoding')
  ) {
    draft.headers = draft.headers.filter(
      (header) => header.name.toLowerCase() !== 'accept-encoding'
    );
    notices.push(
      'Compression options and Accept-Encoding are omitted: the relay negotiates and decodes gzip. Other content encodings are not decoded.'
    );
  }
  const prepared = prepareHTTPExecution(draft, auth);
  if (!prepared.ok) throw new Error(prepared.error);
  return { draft, auth, credentialCount: credentials, notices };
}
