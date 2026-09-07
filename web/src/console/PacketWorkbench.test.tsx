import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { type PacketReport, packetRequest, parsePacketReport } from './packet-api';
import { createProtoPeekRouter } from './router';

vi.mock('./packet-api', async (original) => ({
  ...(await original<typeof import('./packet-api')>()),
  packetRequest: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const report: PacketReport = {
  format: 'PCAP',
  packetCount: 75,
  wireBytes: 7500,
  capturedBytes: 7500,
  limited: false,
  warnings: [],
  protocols: { DNS: 25, TCP: 50 },
  packets: Array.from({ length: 75 }, (_, index) => ({
    number: index + 1,
    interface: 0,
    length: 100,
    captured: 100,
    source: '192.0.2.10',
    destination: '198.51.100.20',
    protocol: index % 3 === 2 ? 'DNS' : 'TCP',
    info: index % 3 === 2 ? 'Query qa.example' : 'SYN',
    truncated: false,
    sourcePort: 50000 + index,
    destinationPort: index % 3 === 2 ? 53 : 443,
  })),
};
function show() {
  return render(
    <RouterProvider
      router={createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/network/packets'] }))}
    />
  );
}

it('reads an explicit file, pages and filters packets, and clears retained metadata', async () => {
  vi.mocked(packetRequest).mockImplementation(async (path) =>
    path === 'capabilities' ? { available: false, reason: 'No dumpcap' } : report
  );
  show();
  await screen.findByRole('heading', { name: 'Packet inspection' });
  expect(vi.mocked(packetRequest).mock.calls.map(([path]) => path)).toEqual(['capabilities']);
  const file = new File(['fixture'], 'qa.pcap');
  fireEvent.change(screen.getByLabelText('Packet capture file'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect file' }));
  await screen.findByRole('button', { name: 'Inspect packet 1' });
  expect(screen.queryByRole('button', { name: 'Inspect packet 51' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next packets' }));
  await screen.findByRole('button', { name: 'Inspect packet 51' });
  fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'DNS' } });
  await screen.findByRole('button', { name: 'Inspect packet 3' });
  expect(screen.getByText('25 matching rows')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect packet 3' }));
  expect(screen.getByRole('complementary', { name: 'Packet 3 details' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear results' }));
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Inspect file' })).toBeEnabled();
  expect(vi.mocked(packetRequest).mock.calls.filter(([path]) => path === 'analyze')).toHaveLength(
    1
  );
});

it('cancels file analysis and ignores a late result', async () => {
  let finish!: (value: PacketReport) => void;
  let signal: AbortSignal | undefined;
  vi.mocked(packetRequest).mockImplementation(async (path, _input, abort) => {
    if (path === 'capabilities') return { available: false, reason: 'No dumpcap' };
    signal = abort;
    return new Promise<PacketReport>((resolve) => {
      finish = resolve;
    });
  });
  show();
  await screen.findByRole('heading', { name: 'Packet inspection' });
  fireEvent.change(screen.getByLabelText('Packet capture file'), {
    target: { files: [new File(['bytes'], 'qa.pcap')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect file' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel inspection' }));
  expect(signal?.aborted).toBe(true);
  finish(report);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Inspect file' })).toBeEnabled());
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('requires an interface, scoped filter and permission before capture', async () => {
  vi.mocked(packetRequest).mockImplementation(async (path) =>
    path === 'capabilities'
      ? { available: true }
      : path === 'interfaces'
        ? [{ name: 'qa', label: 'QA fixture' }]
        : report
  );
  show();
  await screen.findByRole('heading', { name: 'Packet inspection' });
  fireEvent.click(screen.getByRole('button', { name: 'Capture this host' }));
  expect(screen.getByRole('button', { name: 'Start capture' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh interfaces' }));
  await screen.findByRole('option', { name: 'QA fixture' });
  fireEvent.change(screen.getByLabelText('Interface'), { target: { value: 'qa' } });
  fireEvent.change(screen.getByLabelText('IP filter'), { target: { value: '127.0.0.1' } });
  expect(screen.getByRole('button', { name: 'Start capture' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Start capture' }));
  await screen.findByRole('table');
  expect(
    vi.mocked(packetRequest).mock.calls.find(([path]) => path === 'capture')?.[1]
  ).toMatchObject({ interface: 'qa', host: '127.0.0.1', seconds: 5, packets: 2000, consent: true });
});

it('rejects invalid packet reports before rendering them', () => {
  for (const invalid of [
    { ...report, packetCount: 20001 },
    { ...report, packets: [{ ...report.packets[0], destinationPort: 99999 }] },
    { ...report, wireBytes: -1 },
  ])
    expect(() => parsePacketReport(invalid)).toThrow();
});
