import type { WebsiteObservationResult } from './security-api';

export type WebsiteEvidenceStatus = 'observed' | 'not observed' | 'attention';

export type WebsiteEvidenceCheck = {
  id:
    | 'https-tls'
    | 'hsts'
    | 'csp'
    | 'frame-embedding'
    | 'nosniff'
    | 'referrer-policy'
    | 'permissions-policy'
    | 'server-disclosure'
    | 'redirect-https';
  label: string;
  status: WebsiteEvidenceStatus;
  summary: string;
  sourceFields: string[];
};

export type WebsiteEvidenceReport = {
  schema: 'protopeek.website-head-evidence';
  version: 1;
  boundary: {
    source: 'one retained website observation';
    method: 'HEAD';
    requestsRepresented: 1;
    additionalTargetRequestsMadeByAnalysis: false;
    redirectsFollowed: false;
    responseBodyRead: false;
    conclusion: 'evidence labels only; no vulnerability verdict or score';
    limitation: string;
  };
  observation: WebsiteObservationResult;
  checks: WebsiteEvidenceCheck[];
};

export const websiteEvidenceLimitation =
  'These labels describe only the retained response to one non-following HEAD request. HEAD evidence can differ from GET responses and application behavior; no vulnerability verdict or score is produced.';

const headerFieldPrefix = 'observation.http.headers.';

function compareStrings(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort(compareStrings);
}

function canonicalHeaders(headers: Record<string, string[]>) {
  const collected = new Map<string, string[]>();
  for (const [name, values] of Object.entries(headers)) {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) continue;
    collected.set(normalizedName, [...(collected.get(normalizedName) ?? []), ...values]);
  }
  return Object.fromEntries(
    [...collected.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, values]) => [name, uniqueSorted(values)])
  );
}

function canonicalObservation(result: WebsiteObservationResult): WebsiteObservationResult {
  return {
    ...result,
    dns: {
      ...result.dns,
      pinnedAddresses: uniqueSorted(result.dns.pinnedAddresses),
    },
    http: {
      ...result.http,
      headers: canonicalHeaders(result.http.headers),
    },
    tls: result.tls
      ? {
          ...result.tls,
          dnsNames: uniqueSorted(result.tls.dnsNames),
        }
      : null,
    timings: { ...result.timings },
  };
}

function valuesFor(observation: WebsiteObservationResult, name: string) {
  return observation.http.headers[name.toLowerCase()] ?? [];
}

function nonEmptyValues(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function compactValue(value: string, maximum = 144) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1)}…`;
}

function isoTimestamp(value: string) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function httpsTLSCheck(observation: WebsiteObservationResult): WebsiteEvidenceCheck {
  const sourceFields = ['observation.url', 'observation.observedAt', 'observation.tls'];
  const isHTTPS = new URL(observation.url).protocol === 'https:';
  const tls = observation.tls;

  if (!isHTTPS && !tls) {
    return {
      id: 'https-tls',
      label: 'HTTPS and TLS',
      status: 'not observed',
      summary: 'The requested URL used HTTP, so this observation contains no TLS session.',
      sourceFields,
    };
  }
  if (!isHTTPS && tls) {
    return {
      id: 'https-tls',
      label: 'HTTPS and TLS',
      status: 'attention',
      summary: 'TLS evidence was retained for an HTTP URL; review the source observation.',
      sourceFields,
    };
  }
  if (!tls) {
    return {
      id: 'https-tls',
      label: 'HTTPS and TLS',
      status: 'attention',
      summary: 'The requested URL used HTTPS, but no TLS session evidence was retained.',
      sourceFields,
    };
  }

  const observedAt = isoTimestamp(observation.observedAt);
  const notBefore = isoTimestamp(tls.notBefore);
  const notAfter = isoTimestamp(tls.notAfter);
  if (!observedAt || !notBefore || !notAfter) {
    return {
      id: 'https-tls',
      label: 'HTTPS and TLS',
      status: 'attention',
      summary:
        'TLS evidence was retained, but its observation or certificate validity date is invalid.',
      sourceFields,
    };
  }
  if (tls.verifiedChains < 1) {
    return {
      id: 'https-tls',
      label: 'HTTPS and TLS',
      status: 'attention',
      summary: `${tls.version || 'TLS'} was observed, but no verified certificate chain was reported.`,
      sourceFields,
    };
  }
  if (observedAt < notBefore || observedAt > notAfter) {
    return {
      id: 'https-tls',
      label: 'HTTPS and TLS',
      status: 'attention',
      summary: `A verified ${tls.version || 'TLS'} session was observed, but the certificate validity window did not include the observation time.`,
      sourceFields,
    };
  }
  return {
    id: 'https-tls',
    label: 'HTTPS and TLS',
    status: 'observed',
    summary: `Verified ${tls.version || 'TLS'} evidence was retained; the certificate was valid at observation time and expires ${notAfter}.`,
    sourceFields,
  };
}

function hstsCheck(observation: WebsiteObservationResult): WebsiteEvidenceCheck {
  const values = nonEmptyValues(valuesFor(observation, 'strict-transport-security'));
  const sourceFields = [`${headerFieldPrefix}strict-transport-security`, 'observation.url'];
  if (!values.length) {
    return {
      id: 'hsts',
      label: 'HSTS',
      status: 'not observed',
      summary: 'No Strict-Transport-Security header was retained in this HEAD response.',
      sourceFields,
    };
  }
  if (new URL(observation.url).protocol !== 'https:') {
    return {
      id: 'hsts',
      label: 'HSTS',
      status: 'attention',
      summary: 'Strict-Transport-Security was observed on HTTP, where browsers do not accept it.',
      sourceFields,
    };
  }
  if (uniqueSorted(values).length > 1) {
    return {
      id: 'hsts',
      label: 'HSTS',
      status: 'attention',
      summary: 'Multiple distinct Strict-Transport-Security values were retained in this response.',
      sourceFields,
    };
  }
  const maxAge = values[0]
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => /^max-age\s*=/i.test(part))
    ?.split('=', 2)[1]
    ?.trim();
  if (!maxAge || !/^\d+$/.test(maxAge)) {
    return {
      id: 'hsts',
      label: 'HSTS',
      status: 'attention',
      summary:
        'Strict-Transport-Security was retained, but a valid max-age directive was not observed.',
      sourceFields,
    };
  }
  if (BigInt(maxAge) === 0n) {
    return {
      id: 'hsts',
      label: 'HSTS',
      status: 'attention',
      summary: 'Strict-Transport-Security was retained with max-age=0.',
      sourceFields,
    };
  }
  return {
    id: 'hsts',
    label: 'HSTS',
    status: 'observed',
    summary: `Strict-Transport-Security was retained with max-age=${maxAge}.`,
    sourceFields,
  };
}

function presenceCheck(
  observation: WebsiteObservationResult,
  id: 'csp' | 'referrer-policy' | 'permissions-policy',
  label: string,
  headerName: string
): WebsiteEvidenceCheck {
  const rawValues = valuesFor(observation, headerName);
  const values = nonEmptyValues(rawValues);
  const sourceFields = [`${headerFieldPrefix}${headerName}`];
  if (!rawValues.length) {
    return {
      id,
      label,
      status: 'not observed',
      summary: `No ${label} header was retained in this HEAD response.`,
      sourceFields,
    };
  }
  if (!values.length) {
    return {
      id,
      label,
      status: 'attention',
      summary: `${label} was retained without a non-empty value.`,
      sourceFields,
    };
  }
  return {
    id,
    label,
    status: 'observed',
    summary: `${label} was retained${values.length > 1 ? ` with ${values.length} values` : ''}: ${compactValue(values.join(' | '))}`,
    sourceFields,
  };
}

function frameEmbeddingCheck(observation: WebsiteObservationResult): WebsiteEvidenceCheck {
  const cspValues = nonEmptyValues(valuesFor(observation, 'content-security-policy'));
  const frameAncestorDirectives = cspValues.flatMap((policy) =>
    policy
      .split(';')
      .map((directive) => directive.trim())
      .filter((directive) => /^frame-ancestors(?:\s|$)/i.test(directive))
  );
  const xFrameValues = nonEmptyValues(valuesFor(observation, 'x-frame-options'));
  const sourceFields = [
    `${headerFieldPrefix}content-security-policy`,
    `${headerFieldPrefix}x-frame-options`,
  ];

  if (frameAncestorDirectives.length) {
    return {
      id: 'frame-embedding',
      label: 'Frame embedding',
      status: 'observed',
      summary: `CSP frame-ancestors was retained: ${compactValue(frameAncestorDirectives.join(' | '))}`,
      sourceFields,
    };
  }
  if (xFrameValues.length) {
    return {
      id: 'frame-embedding',
      label: 'Frame embedding',
      status: 'observed',
      summary: `X-Frame-Options was retained: ${compactValue(xFrameValues.join(' | '))}`,
      sourceFields,
    };
  }
  return {
    id: 'frame-embedding',
    label: 'Frame embedding',
    status: 'not observed',
    summary: 'Neither CSP frame-ancestors nor X-Frame-Options was retained in this HEAD response.',
    sourceFields,
  };
}

function nosniffCheck(observation: WebsiteObservationResult): WebsiteEvidenceCheck {
  const rawValues = valuesFor(observation, 'x-content-type-options');
  const values = uniqueSorted(nonEmptyValues(rawValues).map((value) => value.toLowerCase()));
  const sourceFields = [`${headerFieldPrefix}x-content-type-options`];
  if (!rawValues.length) {
    return {
      id: 'nosniff',
      label: 'MIME sniffing',
      status: 'not observed',
      summary: 'No X-Content-Type-Options header was retained in this HEAD response.',
      sourceFields,
    };
  }
  if (values.length === 1 && values[0] === 'nosniff') {
    return {
      id: 'nosniff',
      label: 'MIME sniffing',
      status: 'observed',
      summary: 'X-Content-Type-Options: nosniff was retained.',
      sourceFields,
    };
  }
  return {
    id: 'nosniff',
    label: 'MIME sniffing',
    status: 'attention',
    summary: values.includes('nosniff')
      ? 'Conflicting X-Content-Type-Options values were retained.'
      : 'X-Content-Type-Options was retained without the nosniff value.',
    sourceFields,
  };
}

function serverDisclosureCheck(observation: WebsiteObservationResult): WebsiteEvidenceCheck {
  const values = nonEmptyValues(valuesFor(observation, 'server'));
  const sourceFields = [`${headerFieldPrefix}server`];
  if (!values.length) {
    return {
      id: 'server-disclosure',
      label: 'Server disclosure',
      status: 'not observed',
      summary: 'No Server header value was retained in this HEAD response.',
      sourceFields,
    };
  }
  return {
    id: 'server-disclosure',
    label: 'Server disclosure',
    status: 'observed',
    summary: `Server header disclosure was retained: ${compactValue(values.join(' | '))}. This is not a vulnerability verdict.`,
    sourceFields,
  };
}

function redirectHTTPSCheck(observation: WebsiteObservationResult): WebsiteEvidenceCheck {
  const sourceURL = new URL(observation.url);
  const location = observation.http.redirectLocation;
  const isRedirectStatus = observation.http.statusCode >= 300 && observation.http.statusCode < 400;
  const sourceFields = [
    'observation.url',
    'observation.http.statusCode',
    'observation.http.redirectLocation',
  ];

  if (!location) {
    if (isRedirectStatus) {
      return {
        id: 'redirect-https',
        label: 'Redirect and HTTPS path',
        status: 'attention',
        summary: 'A redirect status was observed without a retained Location value.',
        sourceFields,
      };
    }
    if (sourceURL.protocol === 'http:') {
      return {
        id: 'redirect-https',
        label: 'Redirect and HTTPS path',
        status: 'not observed',
        summary: 'No HTTP-to-HTTPS upgrade redirect was observed in this HEAD response.',
        sourceFields,
      };
    }
    return {
      id: 'redirect-https',
      label: 'Redirect and HTTPS path',
      status: 'observed',
      summary: 'The requested URL already used HTTPS and no redirect location was retained.',
      sourceFields,
    };
  }

  let destination: URL;
  try {
    destination = new URL(location, sourceURL);
  } catch {
    return {
      id: 'redirect-https',
      label: 'Redirect and HTTPS path',
      status: 'attention',
      summary:
        'A redirect location was retained, but it could not be resolved against the observed URL.',
      sourceFields,
    };
  }
  if (!isRedirectStatus) {
    return {
      id: 'redirect-https',
      label: 'Redirect and HTTPS path',
      status: 'attention',
      summary: `A Location value was retained with non-redirect status ${observation.http.statusCode}; it was not followed.`,
      sourceFields,
    };
  }
  if (sourceURL.protocol === 'http:' && destination.protocol === 'https:') {
    return {
      id: 'redirect-https',
      label: 'Redirect and HTTPS path',
      status: 'observed',
      summary: `An HTTP-to-HTTPS upgrade location was observed and not followed: ${compactValue(destination.toString())}`,
      sourceFields,
    };
  }
  if (sourceURL.protocol === 'https:' && destination.protocol === 'http:') {
    return {
      id: 'redirect-https',
      label: 'Redirect and HTTPS path',
      status: 'attention',
      summary: `The retained redirect location points from HTTPS to HTTP and was not followed: ${compactValue(destination.toString())}`,
      sourceFields,
    };
  }
  if (destination.protocol === 'http:') {
    return {
      id: 'redirect-https',
      label: 'Redirect and HTTPS path',
      status: 'attention',
      summary: `The retained redirect location remained on HTTP and was not followed: ${compactValue(destination.toString())}`,
      sourceFields,
    };
  }
  return {
    id: 'redirect-https',
    label: 'Redirect and HTTPS path',
    status: 'observed',
    summary: `An HTTPS redirect location was retained and not followed: ${compactValue(destination.toString())}`,
    sourceFields,
  };
}

export function analyzeWebsiteObservation(result: WebsiteObservationResult): WebsiteEvidenceReport {
  const observation = canonicalObservation(result);
  return {
    schema: 'protopeek.website-head-evidence',
    version: 1,
    boundary: {
      source: 'one retained website observation',
      method: 'HEAD',
      requestsRepresented: 1,
      additionalTargetRequestsMadeByAnalysis: false,
      redirectsFollowed: false,
      responseBodyRead: false,
      conclusion: 'evidence labels only; no vulnerability verdict or score',
      limitation: websiteEvidenceLimitation,
    },
    observation,
    checks: [
      httpsTLSCheck(observation),
      hstsCheck(observation),
      presenceCheck(observation, 'csp', 'Content-Security-Policy', 'content-security-policy'),
      frameEmbeddingCheck(observation),
      nosniffCheck(observation),
      presenceCheck(observation, 'referrer-policy', 'Referrer-Policy', 'referrer-policy'),
      presenceCheck(observation, 'permissions-policy', 'Permissions-Policy', 'permissions-policy'),
      serverDisclosureCheck(observation),
      redirectHTTPSCheck(observation),
    ],
  };
}

export function serializeWebsiteEvidenceReport(result: WebsiteObservationResult) {
  return `${JSON.stringify(analyzeWebsiteObservation(result), null, 2)}\n`;
}
