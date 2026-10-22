import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandoffEnvelope } from './app/handoff-store';
import { NetworkDiagnostics } from './NetworkDiagnostics';
import {
  type DiagnosticResult,
  diagnosticDraftTarget,
  diagnosticHandoff,
  diagnosticModes,
  diagnosticsSearch,
} from './network-diagnostics';

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
