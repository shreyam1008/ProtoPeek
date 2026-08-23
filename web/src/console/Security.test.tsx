import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Security } from './Security';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...properties
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode }) => (
    <a href={to} {...properties}>
      {children}
    </a>
  ),
}));

const result = {
  apex: 'example.com',
  source: 'https://crt.name/v1/search?apex=example.com',
  observedAt: '2026-08-23T09:00:00Z',
  candidates: [
    { name: '*.api.example.com', wildcard: true },
    { name: 'app.example.com', wildcard: false },
  ],
  discarded: 0,
  truncated: false,
  cached: false,
};

const websiteResult = {
  observedAt: '2026-08-23T12:00:00Z',
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
      'Content-Security-Policy': ["default-src 'none'"],
      Server: ['example-edge'],
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
    notBefore: '2026-01-01T00:00:00Z',
    notAfter: '2027-01-01T00:00:00Z',
    dnsNames: ['example.com'],
    verifiedChains: 1,
  },
  timings: { connectMs: 8.2, tlsHandshakeMs: 12.4, firstByteMs: 24.7, totalMs: 25.1 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
  document.cookie = '_protopeek_csrf_token=; Max-Age=0; path=/';
});

describe('Security', () => {
  it('starts idle with an unchecked disclosure and truthful current/planned surfaces', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<Security />);

    expect(screen.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
    expect(screen.getByText('Nothing runs on page load.')).toBeVisible();
    expect(screen.getByLabelText(/Send this registrable domain to crt\.name/i)).not.toBeChecked();
    expect(screen.getByLabelText(/Make one public HEAD request/i)).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Find historical names' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Observe website' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    expect(
      screen.getByRole('heading', { name: 'Continue with shipped network evidence' })
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Observe one public website response' })
    ).toBeVisible();
    expect(screen.getAllByText('Planned')).toHaveLength(2);
    expect(screen.getByText('Consent-bound website probe plans')).toBeVisible();
    expect(screen.getByText('Selected-port security handoff')).toBeVisible();
    expect(screen.getByRole('link', { name: /Open DNS evidence/i })).toHaveAttribute(
      'href',
      '/network/path'
    );
    expect(screen.getByRole('link', { name: /Open route evidence/i })).toHaveAttribute(
      'href',
      '/network/route'
    );
    expect(screen.getByRole('link', { name: /Open local discovery/i })).toHaveAttribute(
      'href',
      '/network/local'
    );
  });

  it('requires one acknowledgement, sends one lookup, then lists passive historical evidence', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=security-token; path=/';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(result)
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Security />);

    fireEvent.change(screen.getByLabelText('Apex or host'), {
      target: { value: 'WWW.Example.com.' },
    });
    const disclosure = screen.getByLabelText(/Send this registrable domain to crt\.name/i);
    fireEvent.click(disclosure);
    fireEvent.click(screen.getByRole('button', { name: 'Find historical names' }));

    expect(await screen.findByText('*.api.example.com')).toBeVisible();
    expect(screen.getByText('app.example.com')).toBeVisible();
    expect(screen.getByText('Wildcard pattern')).toBeVisible();
    expect(screen.getByText('Historical name')).toBeVisible();
    expect(disclosure).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      host: 'www.example.com',
      acknowledgeThirdParty: true,
    });
    const list = screen.getByRole('list', {
      name: 'Historical certificate names for example.com',
    });
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText(/not proof of a live host, open port, owner, or vulnerability/i)
    ).toBeVisible();
  });

  it('cancels an in-flight lookup and requires a fresh acknowledgement', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('cancelled', 'AbortError'));
          });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Security />);

    fireEvent.change(screen.getByLabelText('Apex or host'), { target: { value: 'example.com' } });
    const disclosure = screen.getByLabelText(/Send this registrable domain to crt\.name/i);
    fireEvent.click(disclosure);
    fireEvent.click(screen.getByRole('button', { name: 'Find historical names' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel lookup' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Lookup cancelled. No returned name was resolved or probed.'
      )
    );
    expect(disclosure).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Find historical names' })).toBeDisabled();
  });

  it('runs one separately acknowledged website observation and renders evidence without a verdict', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=website-token; path=/';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(websiteResult)
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Security />);

    fireEvent.change(screen.getByLabelText('Public website URL'), {
      target: { value: 'HTTPS://EXAMPLE.com/health' },
    });
    const disclosure = screen.getByLabelText(/Make one public HEAD request/i);
    fireEvent.click(disclosure);
    fireEvent.click(screen.getByRole('button', { name: 'Observe website' }));

    expect(await screen.findByText('204 No Content')).toBeVisible();
    expect(screen.getByText('203.0.113.20')).toBeVisible();
    expect(screen.getByText('TLS 1.3')).toBeVisible();
    expect(screen.getByText(/1 verified chain reported/i)).toBeVisible();
    expect(disclosure).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://example.com/health',
      acknowledgePublicRequest: true,
    });
    expect(screen.queryByText(/secure score/i)).not.toBeInTheDocument();
    expect(screen.getByText('Reported, never followed')).toBeVisible();
    expect(screen.getByText('Never read')).toBeVisible();
    expect(
      await screen.findByRole('heading', { name: 'HEAD evidence report' }, { timeout: 5_000 })
    ).toBeVisible();
    expect(screen.getByRole('list', { name: 'HEAD response evidence checks' })).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'HEAD response evidence checks' })).getAllByRole(
        'listitem'
      )
    ).toHaveLength(9);
    const tlsCheck = screen.getByText('HTTPS and TLS').closest('li');
    const hstsCheck = screen.getByText('HSTS').closest('li');
    const serverCheck = screen.getByText('Server disclosure').closest('li');
    expect(tlsCheck).not.toBeNull();
    expect(hstsCheck).not.toBeNull();
    expect(serverCheck).not.toBeNull();
    if (!tlsCheck || !hstsCheck || !serverCheck) {
      throw new Error('Expected every evidence check to render as a list item.');
    }
    expect(within(tlsCheck).getByText('Observed')).toBeVisible();
    expect(within(hstsCheck).getByText('Not observed')).toBeVisible();
    expect(within(serverCheck).getByText('Observed')).toBeVisible();
    expect(
      screen.getByText(/HEAD evidence can differ from GET responses and application behavior/i)
    ).toBeVisible();
    expect(screen.getByText(/no vulnerability verdict or score is produced/i)).toBeVisible();
  });

  it('copies a versioned JSON report without making another network request', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=website-token; path=/';
    const fetchMock = vi.fn(async () => Response.json(websiteResult));
    const writeText = vi.fn(async (_value: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Security />);

    fireEvent.change(screen.getByLabelText('Public website URL'), {
      target: { value: 'https://example.com/health' },
    });
    fireEvent.click(screen.getByLabelText(/Make one public HEAD request/i));
    fireEvent.click(screen.getByRole('button', { name: 'Observe website' }));
    await screen.findByRole('heading', { name: 'HEAD evidence report' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON report' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = JSON.parse(String(writeText.mock.calls[0]?.[0]));
    expect(copied).toMatchObject({
      schema: 'protopeek.website-head-evidence',
      version: 1,
      boundary: {
        method: 'HEAD',
        requestsRepresented: 1,
        additionalTargetRequestsMadeByAnalysis: false,
        redirectsFollowed: false,
        responseBodyRead: false,
      },
      observation: { url: 'https://example.com/health', method: 'HEAD' },
    });
    expect(copied.checks).toHaveLength(9);
    expect(copied.checks.map((check: { status: string }) => check.status)).toEqual(
      expect.arrayContaining(['observed', 'not observed'])
    );
    expect(await screen.findByText('JSON evidence report copied.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports clipboard failure without claiming that evidence was copied', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=website-token; path=/';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(websiteResult))
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    render(<Security />);

    fireEvent.change(screen.getByLabelText('Public website URL'), {
      target: { value: 'https://example.com/health' },
    });
    fireEvent.click(screen.getByLabelText(/Make one public HEAD request/i));
    fireEvent.click(screen.getByRole('button', { name: 'Observe website' }));
    await screen.findByRole('heading', { name: 'HEAD evidence report' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON report' }));

    expect(await screen.findByText(/could not be copied.*Allow clipboard access/i)).toBeVisible();
    expect(screen.queryByText('JSON evidence report copied.')).not.toBeInTheDocument();
  });
});
