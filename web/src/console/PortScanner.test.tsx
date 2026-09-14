import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewPorts } from './port-scan';
import { scanHostPorts } from './port-scan-api';
import { createProtoPeekRouter } from './router';

vi.mock('./port-scan-api', () => ({ scanHostPorts: vi.fn() }));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});
describe('port scanner', () => {
  it('previews unique ports and rejects oversized ranges', () => {
    expect(previewPorts('443,80,8000-8002,443')).toEqual([80, 443, 8000, 8001, 8002]);
    for (const value of ['0', '65536', '1-1025', '80,,443', '443-80'])
      expect(() => previewPorts(value)).toThrow();
  });
  it('stays quiet until Scan, displays open results, and reveals refused ports on demand', async () => {
    vi.mocked(scanHostPorts).mockResolvedValue({
      host: '127.0.0.1',
      address: '127.0.0.1',
      durationMs: 10,
      complete: true,
      results: [
        { port: 80, state: 'closed', durationMs: 1 },
        { port: 443, state: 'open', durationMs: 2 },
      ],
    });
    render(
      <RouterProvider
        router={createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/network/ports'] }))}
      />
    );
    expect(await screen.findByRole('heading', { name: 'Port scanner' })).toBeVisible();
    expect(scanHostPorts).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Ports'), { target: { value: '80,443' } });
    fireEvent.click(screen.getByRole('button', { name: 'Scan ports' }));
    expect(await screen.findByText('443/tcp')).toBeVisible();
    expect(screen.queryByText('80/tcp')).not.toBeInTheDocument();
    expect(screen.getByText('HTTPS (port hint)')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
    expect(screen.getByText('80/tcp')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect service' }));
    expect(await screen.findByRole('textbox', { name: 'Scan target' })).toHaveValue(
      '127.0.0.1:443'
    );
  });
  it('cancels the request without restarting it', async () => {
    vi.mocked(scanHostPorts).mockImplementation(
      (_input, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        )
    );
    render(
      <RouterProvider
        router={createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/network/ports'] }))}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Scan ports' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel scan' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan ports' })).toBeEnabled());
    expect(screen.getByText('Scan cancelled')).toBeVisible();
    expect(scanHostPorts).toHaveBeenCalledTimes(1);
  });
});

it('prefills a discovered IP without scanning and lets the user select loopback', async () => {
  render(
    <RouterProvider
      router={createProtoPeekRouter(
        createMemoryHistory({ initialEntries: ['/network/ports?host=192.168.44.1'] })
      )}
    />
  );
  expect(await screen.findByLabelText('Host or IP')).toHaveValue('192.168.44.1');
  expect(scanHostPorts).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /This device/ }));
  expect(screen.getByLabelText('Host or IP')).toHaveValue('127.0.0.1');
  expect(screen.getByLabelText('IP family')).toHaveValue('ipv4');
  expect(scanHostPorts).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /One IP or hostname/ }));
  expect(screen.getByLabelText('Host or IP')).toHaveFocus();
});

it('explains remote scan capabilities and links to subnet discovery', async () => {
  render(
    <RouterProvider
      router={createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/network/ports'] }))}
    />
  );
  fireEvent.click(await screen.findByText('What can I scan?'));
  expect(screen.getByText(/Remote scans cannot report PIDs/)).toBeVisible();
  expect(screen.getByRole('link', { name: /My network/ })).toHaveAttribute(
    'href',
    '#/network/local'
  );
  expect(screen.getByRole('link', { name: 'Open Nmap' })).toBeVisible();
  expect(scanHostPorts).not.toHaveBeenCalled();
});

it('selects all TCP ports without starting a scan', async () => {
  render(
    <RouterProvider
      router={createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/network/ports'] }))}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'All ports (1–65535)' }));
  expect(screen.getByLabelText('Ports')).toHaveValue('1-65535');
  expect(screen.getByRole('button', { name: 'Scan ports' })).toBeEnabled();
  expect(scanHostPorts).not.toHaveBeenCalled();
});
