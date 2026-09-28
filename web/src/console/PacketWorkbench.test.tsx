import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
function show(path = '/network/packets') {
  const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: [path] }));
  return { ...render(<RouterProvider router={router} />), router };
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
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  fireEvent.click(screen.getByText(/75 endpoint pairs/));
  fireEvent.click(screen.getByRole('button', { name: /192.0.2.10:50000 ↔ 198.51.100.20:443/ }));
  expect(screen.getByText('1 matching rows')).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Time from start' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(screen.getByText('75 matching rows')).toBeVisible();
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

it('keeps report filters on cancellation and resets them only after a successful new inspection', async () => {
  let finish!: (value: PacketReport) => void;
  let analysisCount = 0;
  vi.mocked(packetRequest).mockImplementation(async (path) => {
    if (path === 'capabilities') return { available: false, reason: 'No dumpcap' };
    analysisCount += 1;
    if (analysisCount === 2)
      return new Promise<PacketReport>((resolve) => {
        finish = resolve;
      });
    return report;
  });
  show();
  await screen.findByRole('heading', { name: 'Packet inspection' });
  fireEvent.change(screen.getByLabelText('Packet capture file'), {
    target: { files: [new File(['bytes'], 'qa.pcap')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect file' }));
  await screen.findByRole('button', { name: 'Inspect packet 1' });
  fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'TCP' } });
  fireEvent.change(screen.getByLabelText('Filter packets'), { target: { value: 'SYN' } });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect packet 1' }));

  fireEvent.click(screen.getByRole('button', { name: 'Inspect file' }));
  expect(screen.getByRole('button', { name: 'Clear results' })).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel inspection' }));
  await act(async () => finish({ ...report, packetCount: 0, packets: [] }));
  expect(screen.getByText('50 matching rows')).toBeVisible();
  expect(screen.getByLabelText('Protocol')).toHaveValue('TCP');
  expect(screen.getByLabelText('Filter packets')).toHaveValue('SYN');
  expect(screen.getByRole('complementary', { name: 'Packet 1 details' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Inspect file' }));
  expect(await screen.findByText('75 matching rows')).toBeVisible();
  expect(screen.getByLabelText('Protocol')).toHaveValue('all');
  expect(screen.getByLabelText('Filter packets')).toHaveValue('');
  expect(screen.queryByRole('complementary', { name: 'Packet 1 details' })).not.toBeInTheDocument();
  expect(screen.getByText('Page 1 of 2')).toBeVisible();
});

it('prefills a device handoff, selects the sole interface and waits for Start capture', async () => {
  vi.mocked(packetRequest).mockImplementation(async (path) =>
    path === 'capabilities'
      ? { available: true }
      : path === 'interfaces'
        ? [{ name: 'qa', label: 'QA fixture' }]
        : report
  );
  show('/network/packets?mode=live&host=192.0.2.10&port=443');
  await screen.findByRole('heading', { name: 'Packet inspection' });
  await screen.findByRole('option', { name: 'QA fixture' });
  expect(screen.getByLabelText('Interface')).toHaveValue('qa');
  expect(screen.getByLabelText('IP filter')).toHaveValue('192.0.2.10');
  expect(screen.getByLabelText('Port filter')).toHaveValue(443);
  expect(vi.mocked(packetRequest).mock.calls.map(([path]) => path)).toEqual([
    'capabilities',
    'interfaces',
  ]);
  expect(screen.getByRole('button', { name: 'Start capture' })).toBeEnabled();
  expect(screen.getByText(/a switched network does not expose all/)).toBeVisible();
  expect(
    screen.queryByRole('checkbox', {
      name: /I authorize|Send public|permission to capture|Send these five/,
    })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Start capture' }));
  await screen.findByRole('table');
  expect(
    vi.mocked(packetRequest).mock.calls.find(([path]) => path === 'capture')?.[1]
  ).toMatchObject({
    interface: 'qa',
    host: '192.0.2.10',
    port: 443,
    seconds: 5,
    packets: 2000,
    consent: true,
  });
});

it('keeps capture unavailable until support is installed, then retries read-only discovery', async () => {
  vi.mocked(packetRequest).mockResolvedValueOnce({
    available: false,
    reason: 'Install dumpcap first.',
  });
  show('/network/packets?mode=live&port=8080');
  expect(await screen.findByText('Install dumpcap first.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Start capture' })).toBeDisabled();
  expect(packetRequest).toHaveBeenCalledTimes(1);
  vi.mocked(packetRequest).mockImplementation(async (path) =>
    path === 'capabilities'
      ? { available: true }
      : [
          { name: 'wifi', label: 'Wi-Fi' },
          { name: 'lo', label: 'Loopback' },
        ]
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh interfaces' }));
  await screen.findByRole('option', { name: 'Wi-Fi' });
  expect(screen.getByLabelText('Interface')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Start capture' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Interface'), { target: { value: 'wifi' } });
  expect(screen.getByRole('button', { name: 'Start capture' })).toBeEnabled();
  expect(vi.mocked(packetRequest).mock.calls.some(([path]) => path === 'capture')).toBe(false);
});

it('blocks invalid capture duration before starting a capture', async () => {
  vi.mocked(packetRequest).mockImplementation(async (path) =>
    path === 'capabilities' ? { available: true } : [{ name: 'lo', label: 'Loopback' }]
  );
  show('/network/packets?mode=live&port=8080');
  await screen.findByRole('option', { name: 'Loopback' });
  fireEvent.change(screen.getByLabelText('Duration (seconds)'), { target: { value: '31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start capture' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('duration from 1–30 seconds');
  expect(vi.mocked(packetRequest).mock.calls.some(([path]) => path === 'capture')).toBe(false);
});

it('preserves a new endpoint handoff on the same route without starting capture', async () => {
  vi.mocked(packetRequest).mockImplementation(async (path) =>
    path === 'capabilities' ? { available: true } : [{ name: 'eth0', label: 'Ethernet' }]
  );
  const { router } = show('/network/packets?mode=live&host=192.0.2.10&port=443');
  await screen.findByRole('option', { name: 'Ethernet' });
  await act(async () => {
    await router.navigate({
      to: '/network/packets',
      search: { mode: 'live', host: '192.0.2.20', port: '8080' },
    });
  });
  await waitFor(() => expect(screen.getByLabelText('IP filter')).toHaveValue('192.0.2.20'));
  expect(screen.getByLabelText('Port filter')).toHaveValue(8080);
  expect(vi.mocked(packetRequest).mock.calls.some(([path]) => path === 'capture')).toBe(false);
});

it('rejects invalid packet reports before rendering them', () => {
  for (const invalid of [
    { ...report, packetCount: 20001 },
    { ...report, packets: [{ ...report.packets[0], destinationPort: 99999 }] },
    { ...report, wireBytes: -1 },
    { ...report, protocols: [] },
    { ...report, capturedBytes: report.wireBytes + 1 },
    { ...report, packets: [report.packets[0], report.packets[0]] },
    { ...report, packets: [{ ...report.packets[0], timestamp: 42 }] },
  ])
    expect(() => parsePacketReport(invalid)).toThrow();
});
