import type { MetadataEntry } from '@/shared/types';
import { isSensitiveMetadataName } from '@/shared/utils';
import type { HTTPDraft } from './http-draft-store';

export type HTTPVariable = { name: string; value: string; secret: boolean };
export type HTTPEnvironment = { id: string; name: string; variables: HTTPVariable[] };
export type HTTPEnvironments = { profiles: HTTPEnvironment[]; selectedId: string };
export const httpEnvironmentsKey = 'protopeek.httpEnvironments.v1';
const maxBytes = 128 * 1024;
const variableName = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const placeholder = /\{\{([A-Za-z_][A-Za-z0-9_]{0,63})\}\}/g;

export function isHTTPSecretVariable(variable: HTTPVariable) {
  return variable.secret || isSensitiveMetadataName(variable.name);
}

function validate(value: unknown): HTTPEnvironments {
  const data = value as { version?: unknown; profiles?: HTTPEnvironment[]; selectedId?: unknown };
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > 20 ||
    typeof data.selectedId !== 'string'
  )
    throw new Error('Environment profiles are invalid (maximum 20).');
  const ids = new Set<string>();
  const profiles = data.profiles.map((profile) => {
    if (
      !profile ||
      typeof profile.id !== 'string' ||
      !/^[\w-]{1,64}$/.test(profile.id) ||
      ids.has(profile.id) ||
      typeof profile.name !== 'string' ||
      !profile.name.trim() ||
      profile.name.length > 80 ||
      !Array.isArray(profile.variables) ||
      profile.variables.length > 32
    )
      throw new Error('Each profile needs a unique ID, name and at most 32 variables.');
    ids.add(profile.id);
    const names = new Set<string>();
    const variables = profile.variables.map((variable) => {
      if (
        !variable ||
        typeof variable.name !== 'string' ||
        !variableName.test(variable.name) ||
        names.has(variable.name) ||
        typeof variable.value !== 'string' ||
        new TextEncoder().encode(variable.value).length > 8192 ||
        typeof variable.secret !== 'boolean'
      )
        throw new Error(
          'Use unique variable names (letters, numbers, underscores) and values up to 8 KiB.'
        );
      names.add(variable.name);
      if (variable.value.match(placeholder))
        throw new Error('Variable values cannot contain other variables.');
      return { name: variable.name, value: variable.value, secret: isHTTPSecretVariable(variable) };
    });
    return { id: profile.id, name: profile.name.trim(), variables };
  });
  if (data.selectedId && !ids.has(data.selectedId))
    throw new Error('The selected environment no longer exists.');
  return { profiles, selectedId: data.selectedId };
}

export function readHTTPEnvironments(): HTTPEnvironments & { error: string } {
  try {
    const raw = localStorage.getItem(httpEnvironmentsKey);
    if (raw === null) return { profiles: [], selectedId: '', error: '' };
    if (new TextEncoder().encode(raw).length > maxBytes)
      throw new Error('Environment profiles exceed 128 KiB.');
    const result = validate(JSON.parse(raw));
    return {
      ...result,
      profiles: result.profiles.map((profile) => ({
        ...profile,
        variables: profile.variables.map((variable) => ({
          ...variable,
          value: variable.secret ? '' : variable.value,
        })),
      })),
      error: '',
    };
  } catch (cause) {
    return {
      profiles: [],
      selectedId: '',
      error: cause instanceof Error ? cause.message : 'Environment storage is unavailable.',
    };
  }
}

export function saveHTTPEnvironments(value: HTTPEnvironments) {
  const result = validate({ version: 1, ...value });
  const raw = JSON.stringify({
    version: 1,
    ...result,
    profiles: result.profiles.map((profile) => ({
      ...profile,
      variables: profile.variables.map((variable) => ({
        ...variable,
        value: variable.secret ? '' : variable.value,
      })),
    })),
  });
  if (new TextEncoder().encode(raw).length > maxBytes)
    throw new Error('Environment profiles exceed 128 KiB.');
  localStorage.setItem(httpEnvironmentsKey, raw);
  return result;
}

export function resolveHTTPVariables(profile: HTTPEnvironment | null) {
  const variables = new Map(profile?.variables.map((variable) => [variable.name, variable]) ?? []);
  return (text: string, allowSecret = false): { text: string; secret: boolean } => {
    let secret = false;
    const expanded = text.replace(placeholder, (_, name: string) => {
      const variable = variables.get(name);
      if (!variable) throw new Error(`Set the ${name} variable in the selected environment.`);
      if (isHTTPSecretVariable(variable)) {
        if (!allowSecret)
          throw new Error(`Secret variable ${name} is allowed only in Auth and header values.`);
        if (!variable.value)
          throw new Error(`Re-enter secret variable ${name} in Manage environments.`);
        secret = true;
      }
      if (variable.value.match(placeholder))
        throw new Error('Variable values cannot contain other variables.');
      return variable.value;
    });
    return { text: expanded, secret };
  };
}

export function resolveHTTPTemplate(draft: HTTPDraft, profile: HTTPEnvironment | null) {
  const resolve = resolveHTTPVariables(profile);
  const secretHeaders = new Set<string>();
  const headers = draft.headers.map((header) => {
    const name = resolve(header.name).text;
    const value = resolve(header.value, true);
    if (value.secret) secretHeaders.add(name.trim().toLowerCase());
    return { name, value: value.text };
  });
  return {
    draft: {
      ...draft,
      url: resolve(draft.url).text,
      params: draft.params.map((param) => ({
        name: resolve(param.name).text,
        value: resolve(param.value).text,
      })),
      headers,
      body: draft.bodyMode === 'none' ? '' : resolve(draft.body).text,
    },
    secretHeaders,
    resolve,
  };
}

// Only references are retained for non-allowlisted headers, never their literal credentials.
export function retainHTTPHeaderTemplates(original: MetadataEntry[], sanitized: MetadataEntry[]) {
  return sanitized.map((header, index) => ({
    ...header,
    value: /^(?:(?:Bearer|Basic) )?\{\{[A-Za-z_][A-Za-z0-9_]{0,63}\}\}$/.test(original[index].value)
      ? original[index].value
      : header.value,
  }));
}

export function sanitizeHTTPTemplateURL(value: string, sanitize: (url: string) => string) {
  if (!value.includes('{{')) return sanitize(value);
  const tokens: Array<[string, string]> = [];
  let prefix = 'pp-template-variable';
  while (value.includes(prefix)) prefix += 'x';
  const leading = /^\{\{[A-Za-z_][A-Za-z0-9_]{0,63}\}\}(?=\/|\?|#|$)/.exec(value.trim())?.[0];
  let source = value.trim();
  if (leading) {
    tokens.push([`https://${prefix}.invalid`, leading]);
    source = source.replace(leading, tokens[0][0]);
  }
  let port = 65000;
  while (value.includes(String(port))) port--;
  source = source.replace(
    /:(\{\{[A-Za-z_][A-Za-z0-9_]{0,63}\}\})(?=[/?#]|$)/g,
    (_, token: string) => {
      while (value.includes(String(port))) port--;
      const marker = String(port--);
      tokens.push([marker, token]);
      return `:${marker}`;
    }
  );
  source = source.replace(placeholder, (token) => {
    const marker = `${prefix}-${tokens.length}-end`;
    tokens.push([marker, token]);
    return marker;
  });
  try {
    const parsed = new URL(source);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) return '';
    const parts = /^(https?:\/\/)([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(source);
    if (!parts) return '';
    const authority = parts[2].slice(parts[2].lastIndexOf('@') + 1);
    const query = new URL(sanitize(parsed.toString())).search;
    // Paths remain templates: normalizing /../ against a fake base changes later execution.
    let result = `${parts[1]}${authority}${parts[3]}${query}`;
    for (const [marker, token] of tokens) result = result.replaceAll(marker, token);
    return result;
  } catch {
    return '';
  }
}
