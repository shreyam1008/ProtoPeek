import { describe, expect, it } from 'vitest';

import type { WebsiteObservationResult } from './security-api';
import {
  analyzeWebsiteObservation,
  serializeWebsiteEvidenceReport,
  websiteEvidenceLimitation,
} from './website-evidence';

const completeHTTPSObservation: WebsiteObservationResult = {
  observedAt: '2026-08-23T12:00:00.000Z',
  url: 'https://example.com/health',
  method: 'HEAD',
  dns: {
    hostname: 'example.com',
    pinnedAddresses: ['203.0.113.20'],
    resolutionMs: 4.25,
  },
  http: {
    statusCode: 204,
    status: '204 No Content',
    protocol: 'HTTP/2.0',
    headers: {
      'Content-Security-Policy': ["default-src 'none'; frame-ancestors 'none'"],
      'Permissions-Policy': ['camera=(), microphone=()'],
      'Referrer-Policy': ['strict-origin-when-cross-origin'],
      Server: ['example-edge'],
      'Strict-Transport-Security': ['max-age=31536000; includeSubDomains'],
      'X-Content-Type-Options': ['nosniff'],
    },
    redirectLocation: '',
  },
  tls: {
    version: 'TLS 1.3',
    cipherSuite: 'TLS_AES_128_GCM_SHA256',
    negotiatedProtocol: 'h2',
    serverName: 'example.com',
    subject: 'CN=example.com',
    issuer: 'CN=Example CA',
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z',
    dnsNames: ['example.com'],
    verifiedChains: 1,
  },
  timings: { connectMs: 8.2, tlsHandshakeMs: 12.4, firstByteMs: 24.7, totalMs: 25.1 },
};

function checkMap(result: WebsiteObservationResult) {
  return new Map(
    analyzeWebsiteObservation(result).checks.map((check) => [check.id, check] as const)
  );
}

describe('website HEAD evidence analyzer', () => {
  it('derives a fixed, score-free report from one retained observation', () => {
    const report = analyzeWebsiteObservation(completeHTTPSObservation);

    expect(report.schema).toBe('protopeek.website-head-evidence');
    expect(report.version).toBe(1);
    expect(report.boundary).toEqual({
      source: 'one retained website observation',
      method: 'HEAD',
      requestsRepresented: 1,
      additionalTargetRequestsMadeByAnalysis: false,
      redirectsFollowed: false,
      responseBodyRead: false,
      conclusion: 'evidence labels only; no vulnerability verdict or score',
      limitation: websiteEvidenceLimitation,
    });
    expect(report.checks).toHaveLength(9);
    expect(report.checks.map((check) => check.id)).toEqual([
      'https-tls',
      'hsts',
      'csp',
      'frame-embedding',
      'nosniff',
      'referrer-policy',
      'permissions-policy',
      'server-disclosure',
      'redirect-https',
    ]);
    expect(report.checks.every((check) => check.status === 'observed')).toBe(true);
    expect(report.checks.some((check) => /score|verdict/i.test(check.label))).toBe(false);
  });

  it('normalizes header names and duplicate values deterministically before analysis and export', () => {
    const observation: WebsiteObservationResult = {
      ...completeHTTPSObservation,
      dns: {
        ...completeHTTPSObservation.dns,
        pinnedAddresses: ['203.0.113.20', '198.51.100.3', '203.0.113.20'],
      },
      http: {
        ...completeHTTPSObservation.http,
        headers: {
          server: ['edge-b', 'edge-a'],
          'X-Content-Type-Options': ['nosniff'],
          'x-content-type-options': ['NoSniff', 'nosniff'],
          'x-frame-options': ['SAMEORIGIN'],
          'content-security-policy': ["default-src 'self'"],
        },
      },
    };

    const first = analyzeWebsiteObservation(observation);
    const second = analyzeWebsiteObservation({
      ...observation,
      http: {
        ...observation.http,
        headers: Object.fromEntries(Object.entries(observation.http.headers).reverse()),
      },
    });
    const checks = new Map(first.checks.map((check) => [check.id, check] as const));

    expect(first).toEqual(second);
    expect(first.observation.dns.pinnedAddresses).toEqual(['198.51.100.3', '203.0.113.20']);
    expect(first.observation.http.headers['x-content-type-options']).toEqual([
      'NoSniff',
      'nosniff',
    ]);
    expect(checks.get('nosniff')?.status).toBe('observed');
    expect(checks.get('frame-embedding')).toMatchObject({
      status: 'observed',
      summary: expect.stringContaining('X-Frame-Options'),
    });
    expect(serializeWebsiteEvidenceReport(observation)).toBe(
      serializeWebsiteEvidenceReport(observation)
    );
    expect(serializeWebsiteEvidenceReport(observation).endsWith('\n')).toBe(true);
  });

  it('marks invalid certificate dates and conflicting retained values for attention without throwing', () => {
    const checks = checkMap({
      ...completeHTTPSObservation,
      http: {
        ...completeHTTPSObservation.http,
        headers: {
          'Strict-Transport-Security': ['max-age=31536000', 'max-age=0'],
          'X-Content-Type-Options': ['nosniff', 'invalid'],
        },
      },
      tls: completeHTTPSObservation.tls
        ? { ...completeHTTPSObservation.tls, notAfter: 'not-a-date' }
        : null,
    });

    expect(checks.get('https-tls')).toMatchObject({ status: 'attention' });
    expect(checks.get('https-tls')?.summary).toMatch(/date is invalid/i);
    expect(checks.get('hsts')).toMatchObject({ status: 'attention' });
    expect(checks.get('hsts')?.summary).toMatch(/multiple distinct/i);
    expect(checks.get('nosniff')).toMatchObject({ status: 'attention' });
    expect(checks.get('nosniff')?.summary).toMatch(/conflicting/i);
  });

  it('reports HTTP, no TLS, no redirect, and missing selected headers as not observed', () => {
    const checks = checkMap({
      ...completeHTTPSObservation,
      url: 'http://example.com/',
      http: {
        ...completeHTTPSObservation.http,
        statusCode: 200,
        status: '200 OK',
        headers: {},
        redirectLocation: '',
      },
      tls: null,
      timings: {
        ...completeHTTPSObservation.timings,
        tlsHandshakeMs: null,
      },
    });

    expect(checks.get('https-tls')).toMatchObject({ status: 'not observed' });
    expect(checks.get('redirect-https')).toMatchObject({ status: 'not observed' });
    for (const id of [
      'hsts',
      'csp',
      'frame-embedding',
      'nosniff',
      'referrer-policy',
      'permissions-policy',
      'server-disclosure',
    ] as const) {
      expect(checks.get(id)?.status).toBe('not observed');
    }
  });

  it('distinguishes an observed HTTP upgrade from an HTTPS downgrade without following either', () => {
    const upgrade = checkMap({
      ...completeHTTPSObservation,
      url: 'http://example.com/',
      http: {
        ...completeHTTPSObservation.http,
        statusCode: 301,
        status: '301 Moved Permanently',
        redirectLocation: 'https://example.com/',
      },
      tls: null,
    }).get('redirect-https');
    const downgrade = checkMap({
      ...completeHTTPSObservation,
      http: {
        ...completeHTTPSObservation.http,
        statusCode: 302,
        status: '302 Found',
        redirectLocation: 'http://example.com/',
      },
    }).get('redirect-https');
    const missingLocation = checkMap({
      ...completeHTTPSObservation,
      http: {
        ...completeHTTPSObservation.http,
        statusCode: 307,
        status: '307 Temporary Redirect',
        redirectLocation: '',
      },
    }).get('redirect-https');
    const relativeHTTPS = checkMap({
      ...completeHTTPSObservation,
      http: {
        ...completeHTTPSObservation.http,
        statusCode: 302,
        status: '302 Found',
        redirectLocation: '/signed-out',
      },
    }).get('redirect-https');
    const relativeHTTP = checkMap({
      ...completeHTTPSObservation,
      url: 'http://example.com/start',
      http: {
        ...completeHTTPSObservation.http,
        statusCode: 302,
        status: '302 Found',
        redirectLocation: '/landing',
      },
      tls: null,
    }).get('redirect-https');

    expect(upgrade).toMatchObject({ status: 'observed' });
    expect(upgrade?.summary).toMatch(/not followed/i);
    expect(downgrade).toMatchObject({ status: 'attention' });
    expect(downgrade?.summary).toMatch(/HTTPS to HTTP.*not followed/i);
    expect(missingLocation).toMatchObject({ status: 'attention' });
    expect(missingLocation?.summary).toMatch(/without a retained Location/i);
    expect(relativeHTTPS).toMatchObject({ status: 'observed' });
    expect(relativeHTTPS?.summary).toContain('https://example.com/signed-out');
    expect(relativeHTTP).toMatchObject({ status: 'attention' });
    expect(relativeHTTP?.summary).toContain('http://example.com/landing');
  });
});
