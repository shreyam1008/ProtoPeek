import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandoffEnvelope } from './app/handoff-store';
import type { PendingHandoffInput } from './app/handoff-types';
import { NetworkDiagnostics } from './NetworkDiagnostics';
import {
  type DiagnosticResult,
  diagnosticDraftTarget,
  diagnosticHandoff,
  diagnosticModes,
  diagnosticsSearch,
  diagnosticTargetScheme,
} from './network-diagnostics';
import { ProtocolShellContext, type ProtocolShellValue } from './ProtocolShellContext';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), search: {} as Record<string, string> }));
vi.mock('./api', () => ({ fetchJSON: mocks.fetch }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mocks.search,
  Link: ({ children }: { children: React.ReactNode }) => <a href="#next">{children}</a>,
}));
const result = {
  mode: 'diagnose',
  target: '127.0.0.1:443',
  observedAt: '2026-10-22T11:00:00Z',
  durationMs: 3.5,
  complete: true,
  summary: 'TCP evidence only.',
  outcome: 'success',
  addresses: ['127.0.0.1'],
  checks: [],
  dns: [],
  samples: [],
  warnings: [],
};
beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.search = {};
});

describe('Diagnostics workspace', () => {
  const handoffModes = [
    'diagnose',
    'tls',
    'ip-compare',
    'availability',
    'tcp-exchange',
    'http-proxy',
    'socks5-proxy',
    'http2',
    'http3',
  ] as const;
  it.each(
    handoffModes.flatMap((mode) =>
      (['http', 'https', null] as const).map((scheme) => ({ mode, scheme }))
    )
  )('preserves submitted $scheme transport in $mode handoffs', async ({ mode, scheme }) => {
    mocks.search = {
      mode,
      target: `${scheme ? `${scheme}://` : ''}example.test:8443`,
    };
    mocks.fetch.mockResolvedValue({ ...result, mode, target: 'example.test:8443' });
    const openHandoff = vi.fn((input: PendingHandoffInput) => {
      const checked = createHandoffEnvelope(input, { now: Date.parse(result.observedAt) + 1000 });
      expect(checked.ok).toBe(true);
      return checked.ok ? { ...checked, storage: 'memory' as const } : checked;
    });
    render(
      <ProtocolShellContext.Provider value={{ openHandoff } as unknown as ProtocolShellValue}>
        <NetworkDiagnostics />
      </ProtocolShellContext.Provider>
    );
    if (mode === 'http-proxy' || mode === 'socks5-proxy')
      fireEvent.change(screen.getByLabelText('Proxy address'), {
        target: { value: '127.0.0.1:1080' },
      });
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    await screen.findByRole('region', { name: 'Diagnostic result' });
    const secure = scheme ? scheme === 'https' : ['diagnose', 'tls', 'http3'].includes(mode);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare HTTP request' }));
    expect(openHandoff.mock.lastCall?.[0].draft).toEqual({
      kind: 'http-url-draft',
      target: { kind: 'http-url', url: `${secure ? 'https' : 'http'}://example.test:8443/` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare gRPC target' }));
    expect(openHandoff.mock.lastCall?.[0].draft).toEqual({
      kind: 'grpc-target-draft',
      target: { kind: 'grpc-target', address: 'example.test:8443', plaintext: !secure },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('derives an explicit scheme visibly and keeps the manual TLS choice for bare targets', async () => {
    mocks.fetch.mockResolvedValue(result);
    render(<NetworkDiagnostics />);
    const checkbox = screen.getByRole('checkbox', { name: 'Verify TLS after connecting' });
    const target = screen.getByLabelText('Target');
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    fireEvent.change(target, { target: { value: 'HTTPS://example.test:8443' } });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/Set by https:\/\//)).toBeVisible();
    expect(checkbox).toHaveAccessibleDescription(/Set by https:\/\//);
    fireEvent.change(target, { target: { value: 'http://example.test:8443' } });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    await screen.findByRole('region', { name: 'Diagnostic result' });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).testTls).toBe(false);
    fireEvent.change(target, { target: { value: 'example.test:8443' } });
    expect(checkbox).toBeEnabled();
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toHaveAttribute('aria-describedby');
  });

  it('keeps the submitted transport when the next draft is edited after completion', async () => {
    mocks.search = { mode: 'availability', target: 'https://example.test:8443' };
    mocks.fetch.mockResolvedValue({ ...result, mode: 'availability', target: 'example.test:8443' });
    const openHandoff = vi.fn(() => ({ ok: false as const, error: 'Fixture only' }));
    render(
      <ProtocolShellContext.Provider value={{ openHandoff } as unknown as ProtocolShellValue}>
        <NetworkDiagnostics />
      </ProtocolShellContext.Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    await screen.findByRole('region', { name: 'Diagnostic result' });
    fireEvent.change(screen.getByLabelText('Target'), {
      target: { value: 'http://different.test:8080' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare HTTP request' }));
    expect(openHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: {
          kind: 'http-url-draft',
          target: { kind: 'http-url', url: 'https://example.test:8443/' },
        },
      })
    );
  });

  it.each(['dns', 'http2'] as const)('preserves repeated %s observations', async (mode) => {
    mocks.search = { mode, target: '127.0.0.1:8080' };
    const record = { name: 'fixture.', type: 'TXT', value: 'Repeated evidence', ttlSeconds: 10 };
    mocks.fetch.mockResolvedValue({
      ...result,
      mode,
      dns:
        mode === 'dns'
          ? [
              {
                resolver: 'fixture',
                transport: 'UDP',
                outcome: 'answered',
                durationMs: 1,
                records: [record, record],
              },
            ]
          : [],
      http2:
        mode === 'http2'
          ? {
              protocol: 'h2c',
              pingAck: true,
              settings: ['Repeated evidence', 'Repeated evidence'],
              detail: '',
            }
          : undefined,
    });
    render(<NetworkDiagnostics />);
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    await screen.findByRole('region', { name: 'Diagnostic result' });
    expect(screen.getAllByText('Repeated evidence')).toHaveLength(2);
  });
  it('offers all thirteen modes and does no work until Run', () => {
    render(<NetworkDiagnostics />);
    for (const [, label] of diagnosticModes)
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Diagnostic'), { target: { value: 'subnet' } });
    expect(screen.getByLabelText('CIDR prefix')).toBeInTheDocument();
    expect(screen.queryByLabelText('Probe timeout')).not.toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('deep links create an unsent draft; subnet results retain exact strings', async () => {
    mocks.search = { mode: 'subnet', target: '2001:db8::/64' };
    mocks.fetch.mockResolvedValue({
      ...result,
      mode: 'subnet',
      target: '2001:db8::/64',
      addresses: [],
      subnet: {
        prefix: '2001:db8::/64',
        family: 'IPv6',
        network: '2001:db8::',
        first: '2001:db8::',
        last: '2001:db8::ffff:ffff:ffff:ffff',
        totalAddresses: '18446744073709551616',
        usableHosts: '18446744073709551616',
        firstUsable: '2001:db8::',
        lastUsable: '2001:db8::ffff:ffff:ffff:ffff',
        discoveryEligible: false,
        detail: 'Calculated locally',
      },
    });
    render(<NetworkDiagnostics />);
    expect(screen.getByLabelText('CIDR prefix')).toHaveValue('2001:db8::/64');
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await screen.findByRole('region', { name: 'Diagnostic result' });
    expect(screen.getAllByText('18446744073709551616')).toHaveLength(2);
    expect(screen.queryByText('Prepare a nearby-device scan')).not.toBeInTheDocument();
  });
  it('aborts pending work, preserves no fabricated completed result, and ignores late completion', async () => {
    let complete: (value: typeof result) => void = () => {};
    mocks.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    render(<NetworkDiagnostics />);
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: '127.0.0.1:443' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel diagnostic' }));
    expect(signal.aborted).toBe(true);
    await act(async () => complete(result));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Cancel diagnostic' })).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('region', { name: 'Diagnostic result' })).not.toBeInTheDocument();
  });
  it('displays failures and sends only credentials relevant to the chosen mode', async () => {
    mocks.fetch.mockRejectedValue(new Error('Resolver could not answer.'));
    render(<NetworkDiagnostics />);
    fireEvent.change(screen.getByLabelText('Diagnostic'), { target: { value: 'dns' } });
    fireEvent.change(screen.getByLabelText('DNS name'), { target: { value: 'example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resolver could not answer.');
    const sent = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(sent.proxyPassword).toBe('');
    expect(sent.caPem).toBe('');
    expect(sent.payload).toBe('');
  });
  it('does not render reply bytes as HTML', async () => {
    mocks.fetch.mockResolvedValue({
      ...result,
      mode: 'tcp-exchange',
      exchange: {
        protocol: 'tcp',
        sentBytes: 0,
        receivedBytes: 23,
        replyText: '<img src=x onerror=bad()>',
        replyHex: '3c696d67',
        outcome: 'received',
        limited: false,
      },
    });
    mocks.search = { mode: 'tcp-exchange', target: '127.0.0.1:80' };
    const { container } = render(<NetworkDiagnostics />);
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    await screen.findByText('<img src=x onerror=bad()>');
    expect(container.querySelector('img')).toBeNull();
  });
});

it('validates all mode deep links and bounds input', () => {
  for (const [mode] of diagnosticModes) expect(diagnosticsSearch({ mode }).mode).toBe(mode);
  expect(diagnosticsSearch({ mode: 'run-shell', target: 'x\nHost: injected' })).toEqual({
    mode: undefined,
    target: undefined,
  });
  expect(diagnosticsSearch({ target: 'a'.repeat(1025) }).target).toBeUndefined();
});

it('prepares only an authority for diagnostics without URL secrets or resource data', () => {
  expect(
    diagnosticDraftTarget('https://user:private@localhost:8443/private?token=secret#fragment')
  ).toBe('https://localhost:8443');
  expect(diagnosticDraftTarget('http://[::1]:8080/')).toBe('http://[::1]:8080');
  expect(diagnosticDraftTarget('http://localhost/private')).toBe('http://localhost');
  expect(diagnosticDraftTarget('file:///secret')).toBeUndefined();
  expect(diagnosticDraftTarget('{{base}}/resource')).toBeUndefined();
});

it('parses explicit HTTP transport case-insensitively without guessing a bare authority', () => {
  expect(diagnosticTargetScheme(' HTTP://localhost:8080/ ')).toBe('http');
  expect(diagnosticTargetScheme('HTTPS://[::1]:8443')).toBe('https');
  expect(diagnosticTargetScheme('localhost:8080')).toBeNull();
  expect(diagnosticTargetScheme('file:///private')).toBeNull();
});

it('uses the real broker and preserves attempted TLS through failed verification or connection', () => {
  for (const mode of ['diagnose', 'tls', 'http3'] as const) {
    const evidence = { ...result, mode } as DiagnosticResult;
    for (const protocol of ['http', 'grpc'] as const) {
      const draft = diagnosticHandoff(evidence, protocol, true);
      const prepared = createHandoffEnvelope(draft, {
        now: Date.parse(evidence.observedAt) + 1_000,
      });
      expect(prepared.ok).toBe(true);
      if (draft.draft.kind === 'http-url-draft')
        expect(draft.draft.target.url).toBe('https://127.0.0.1/');
      if (draft.draft.kind === 'grpc-target-draft')
        expect(draft.draft.target.plaintext).toBe(false);
    }
  }
  expect(
    diagnosticHandoff({ ...result, target: '[::1]:8080' } as DiagnosticResult, 'http', false).draft
  ).toEqual({ kind: 'http-url-draft', target: { kind: 'http-url', url: 'http://[::1]:8080/' } });
  expect(() =>
    diagnosticHandoff({ ...result, target: 'https://localhost' } as DiagnosticResult, 'http', true)
  ).toThrow('normalized target');
  const scoped = diagnosticHandoff(
    { ...result, target: '[fe80::1%eth0]:8080' } as DiagnosticResult,
    'grpc',
    false
  );
  expect(createHandoffEnvelope(scoped, { now: Date.parse(result.observedAt) + 1000 }).ok).toBe(
    true
  );
  expect(() =>
    diagnosticHandoff(
      { ...result, target: '[fe80::1%eth0]:8080' } as DiagnosticResult,
      'http',
      false
    )
  ).toThrow('IPv6 interface zone');
});
