import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { clearPendingHandoff, storePendingHandoff } from './app/handoff-store';
import {
  clearOperationReceipts,
  createReceiptRecorder,
  readOperationReceipts,
  recordOperationReceipt,
} from './app/operation-receipts';
import OperationHistory from './OperationHistory';
import { ProtocolShellContext, type ProtocolShellValue } from './ProtocolShellContext';

afterEach(() => {
  clearOperationReceipts();
  clearPendingHandoff();
});

it('shows bounded sanitized evidence, resumes only a manual draft, and clears all activity', () => {
  const openHandoff = vi.fn(storePendingHandoff);
  const shell: ProtocolShellValue = {
    appearance: { version: 2, mode: 'dark', palette: 'graphite' },
    resolvedAppearance: { version: 2, mode: 'dark', palette: 'graphite', theme: 'dark' },
    setAppearance: vi.fn(),
    interfacePreferences: { density: 'comfortable', showKeyboardHints: true },
    setInterfacePreferences: vi.fn(),
    discoveries: [],
    openScan: vi.fn(),
    openHandoff,
    openGRPCDiscovery: vi.fn(),
    openHTTPDiscovery: vi.fn(),
  };
  const receipt = recordOperationReceipt(
    {
      operation: 'http',
      outcome: 'success',
      httpStatus: 200,
      target: { kind: 'http-url', url: 'https://user:password@example.com/private?token=secret' },
    },
    Date.now() - 86400000
  );
  recordOperationReceipt({
    operation: 'grpc',
    outcome: 'failed',
    grpcCode: 13,
    target: { kind: 'grpc-target', address: 'localhost:50051', plaintext: true },
  });
  render(
    <ProtocolShellContext.Provider value={shell}>
      <OperationHistory />
    </ProtocolShellContext.Provider>
  );
  expect(screen.getByText(/HTTP 200/)).toBeVisible();
  expect(screen.getByText(/gRPC code 13/)).toBeVisible();
  expect(screen.getByText(/Earlier success does not establish current reachability/)).toBeVisible();
  expect(screen.queryByText(/password|private\?|token=secret/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /localhost:50051/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'https://example.com/ · HTTP request' }));
  expect(openHandoff).toHaveBeenCalledWith({
    provenance: {
      source: 'operation-history',
      quality: 'manual',
      observedAt: expect.any(String),
      evidenceIds: [receipt?.id],
    },
    draft: { kind: 'http-url-draft', target: { kind: 'http-url', url: 'https://example.com/' } },
  });
  expect(readOperationReceipts()).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Clear all session activity' }));
  expect(readOperationReceipts()).toEqual([]);
  expect(screen.getByText('No explicit operations recorded in this view.')).toBeVisible();
});

it('updates only the selected tool activity and records each terminal operation once', () => {
  render(<OperationHistory operations={['route']} />);
  const finish = createReceiptRecorder({ operation: 'route' });
  expect(screen.getByText('No explicit operations recorded in this view.')).toBeVisible();
  act(() => {
    recordOperationReceipt({ operation: 'http', outcome: 'failed' });
    finish('cancelled', 0);
    finish('success', 1);
  });
  expect(screen.getByText('Next-hop lookup · Cancelled')).toBeVisible();
  expect(screen.queryByText('HTTP request · Failed')).not.toBeInTheDocument();
  expect(readOperationReceipts()).toHaveLength(2);
});
