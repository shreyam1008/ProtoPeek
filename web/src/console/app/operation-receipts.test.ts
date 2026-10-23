import { afterEach, expect, it, vi } from 'vitest';
import { clearPendingHandoff, consumePendingHandoff, storePendingHandoff } from './handoff-store';
import {
  clearOperationReceipts,
  type OperationReceiptInput,
  readOperationReceipts,
  receiptHandoff,
  receiptLimits,
  recentSuccessfulTargets,
  recordOperationReceipt,
  subscribeOperationReceipts,
} from './operation-receipts';

afterEach(() => {
  clearOperationReceipts();
  clearPendingHandoff();
  vi.restoreAllMocks();
});

it('keeps only an origin and allowlisted numeric evidence, with no storage or expanded content', () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const receipt = recordOperationReceipt({
    operation: 'http',
    outcome: 'success',
    target: {
      kind: 'http-url',
      url: 'https://user:password@example.com/private-key/path?token=secret#fragment',
    },
    httpStatus: 204,
    durationMs: 23.5,
    error: 'secret raw error',
    body: 'private content',
    headers: { Authorization: 'Bearer secret' },
  } as OperationReceiptInput);
  expect(receipt).toMatchObject({
    operation: 'http',
    target: { kind: 'http-url', url: 'https://example.com/' },
    httpStatus: 204,
  });
  const encoded = JSON.stringify(readOperationReceipts());
  for (const secret of [
    'password',
    'private-key',
    'token',
    'fragment',
    'Bearer',
    'private content',
    'secret raw error',
  ])
    expect(encoded).not.toContain(secret);
  expect(storage).not.toHaveBeenCalled();
  expect(Object.isFrozen(receipt?.target)).toBe(true);
});

it('bounds count and encoded bytes, rejects unknown operation labels and sanitizes metrics', () => {
  for (let index = 0; index < 80; index++)
    recordOperationReceipt(
      {
        operation: 'http',
        outcome: 'success',
        target: { kind: 'http-url', url: `https://${'x'.repeat(1500)}${index}.test/` },
        durationMs: Number.NaN,
        count: -1,
      },
      1792660800000 + index
    );
  const receipts = readOperationReceipts();
  expect(receipts.length).toBeLessThanOrEqual(receiptLimits.count);
  expect(new TextEncoder().encode(JSON.stringify(receipts)).byteLength).toBeLessThanOrEqual(
    receiptLimits.bytes
  );
  expect(receipts[0].durationMs).toBeUndefined();
  expect(receipts[0].count).toBeUndefined();
  expect(
    recordOperationReceipt({
      operation: 'toString',
      outcome: 'success',
    } as unknown as OperationReceiptInput)
  ).toBeNull();
  expect(recordOperationReceipt({ operation: 'route', outcome: 'success' }, Infinity)).toBeNull();
});

it('promotes only completed successful endpoints and preserves failure, cancellation and partial truth', () => {
  const target = { kind: 'http-url' as const, url: 'https://example.com/path?secret=yes' };
  for (const outcome of ['failed', 'cancelled', 'partial', 'stale'] as const)
    recordOperationReceipt({ operation: 'http', outcome, target });
  recordOperationReceipt({ operation: 'http', outcome: 'success', httpStatus: 500, target });
  recordOperationReceipt({
    operation: 'grpc',
    outcome: 'success',
    grpcCode: 13,
    target: { kind: 'grpc-target', address: 'localhost:50051', plaintext: true },
  });
  expect(recentSuccessfulTargets()).toEqual([]);
  recordOperationReceipt({ operation: 'http', outcome: 'success', httpStatus: 200, target });
  recordOperationReceipt({ operation: 'http', outcome: 'success', httpStatus: 200, target });
  expect(recentSuccessfulTargets()).toHaveLength(1);
});

it('resumes old success as a fresh manual consume-once draft, never an operation or fresh observed evidence', () => {
  const receipt = recordOperationReceipt(
    {
      operation: 'path',
      outcome: 'success',
      target: { kind: 'next-hop-target', target: '192.0.2.1' },
    },
    Date.now() - 86400000
  );
  if (!receipt) throw new Error('missing receipt');
  const draft = receiptHandoff(receipt);
  if (!draft) throw new Error('missing draft');
  expect(draft.provenance.quality).toBe('manual');
  expect(draft.provenance.evidenceIds).toEqual([receipt.id]);
  expect(storePendingHandoff(draft).ok).toBe(true);
  expect(consumePendingHandoff('path-target-draft')?.draft.target.target).toBe('192.0.2.1');
  expect(consumePendingHandoff('path-target-draft')).toBeNull();
  expect(readOperationReceipts()).toHaveLength(1);
});

it('notifies live views and clears the in-memory records explicitly', () => {
  const listener = vi.fn();
  const unsubscribe = subscribeOperationReceipts(listener);
  recordOperationReceipt({ operation: 'socket-inspection', outcome: 'partial', count: 3 });
  clearOperationReceipts();
  expect(listener).toHaveBeenCalledTimes(2);
  expect(readOperationReceipts()).toEqual([]);
  unsubscribe();
});
