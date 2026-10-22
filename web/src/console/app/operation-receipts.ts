import { createHandoffEnvelope } from './handoff-store';
import type { HandoffDraft, PendingHandoffInput, TargetRef } from './handoff-types';

export const receiptOperations = {
  http: 'HTTP request',
  grpc: 'gRPC call',
  path: 'Network path',
  route: 'Next-hop lookup',
  discovery: 'Service discovery',
  'local-scan': 'Local network scan',
  'nmap-import': 'Nmap XML import',
  'packet-file': 'Packet file inspection',
  'packet-capture': 'Local packet capture',
  'socket-inspection': 'Local socket inspection',
  'traffic-sample': 'Interface traffic sample',
  'public-identity': 'Public identity check',
  download: 'Download operation',
  'service-action': 'Service action',
  diagnostics: 'Network diagnostic',
} as const;
export type ReceiptOperation = keyof typeof receiptOperations;
export type ReceiptOutcome = 'success' | 'failed' | 'cancelled' | 'partial' | 'stale';
export type OperationReceiptInput = {
  operation: ReceiptOperation;
  outcome: ReceiptOutcome;
  target?: TargetRef;
  durationMs?: number;
  count?: number;
  httpStatus?: number;
  grpcCode?: number;
};
export type OperationReceipt = Readonly<OperationReceiptInput & { id: string; observedAt: string }>;
export const receiptLimits = { count: 40, bytes: 32 << 10, recentTargets: 10 } as const;
const empty: readonly OperationReceipt[] = Object.freeze([]);
let receipts = empty;
const listeners = new Set<() => void>();
let sequence = 0;

function safeTarget(target: TargetRef | undefined, now: number): TargetRef | undefined {
  if (!target) return;
  try {
    let draft: HandoffDraft;
    if (target.kind === 'http-url') {
      if (target.url.length > 2048) return;
      const url = new URL(target.url);
      // Origins are enough to resume an endpoint. Paths, parameters, fragments and
      // user information can contain credentials even when their names look harmless.
      draft = { kind: 'http-url-draft', target: { kind: 'http-url', url: `${url.origin}/` } };
    } else if (target.kind === 'grpc-target') draft = { kind: 'grpc-target-draft', target };
    else if (target.kind === 'next-hop-target') draft = { kind: 'next-hop-target-draft', target };
    else return;
    const validated = createHandoffEnvelope(
      {
        provenance: {
          source: 'operation-history',
          quality: 'manual',
          observedAt: new Date(now).toISOString(),
        },
        draft,
      },
      { now }
    );
    if (validated.ok && 'target' in validated.value.draft)
      return Object.freeze({ ...validated.value.draft.target });
  } catch {
    /* Invalid or templated identities are omitted; raw execution inputs never become labels. */
  }
}

function metric(value: number | undefined, maximum: number, minimum = 0) {
  return value !== undefined && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

/** Call only after an explicit operation settles. Free-form errors/payloads are deliberately absent. */
export function recordOperationReceipt(
  input: OperationReceiptInput,
  now = Date.now()
): OperationReceipt | null {
  if (
    !Object.hasOwn(receiptOperations, input.operation) ||
    !['success', 'failed', 'cancelled', 'partial', 'stale'].includes(input.outcome) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > 8640000000000000
  )
    return null;
  const target = safeTarget(input.target, now);
  const receipt = Object.freeze({
    id: `operation-${now}-${++sequence}`,
    observedAt: new Date(now).toISOString(),
    operation: input.operation,
    outcome: input.outcome,
    ...(target ? { target } : {}),
    ...(metric(input.durationMs, 86400000) !== undefined ? { durationMs: input.durationMs } : {}),
    ...(Number.isInteger(input.count) && metric(input.count, 1000000) !== undefined
      ? { count: input.count }
      : {}),
    ...(input.operation === 'http' &&
    Number.isInteger(input.httpStatus) &&
    metric(input.httpStatus, 599, 100) !== undefined
      ? { httpStatus: input.httpStatus }
      : {}),
    ...(input.operation === 'grpc' &&
    Number.isInteger(input.grpcCode) &&
    metric(input.grpcCode, 16) !== undefined
      ? { grpcCode: input.grpcCode }
      : {}),
  });
  const next = [receipt, ...receipts].slice(0, receiptLimits.count);
  while (new TextEncoder().encode(JSON.stringify(next)).byteLength > receiptLimits.bytes)
    next.pop();
  receipts = Object.freeze(next);
  for (const listener of listeners) listener();
  return receipt;
}

export function readOperationReceipts() {
  return receipts;
}

/** An exactly-once completion callback; drafts and running operations create no receipt. */
export function createReceiptRecorder(input: Omit<OperationReceiptInput, 'outcome'>) {
  const started = performance.now();
  let finished = false;
  return (outcome: ReceiptOutcome, count?: number) => {
    if (finished) return;
    finished = true;
    recordOperationReceipt({
      ...input,
      outcome,
      count: count ?? input.count,
      durationMs: performance.now() - started,
    });
  };
}
export function subscribeOperationReceipts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function clearOperationReceipts() {
  receipts = empty;
  for (const listener of listeners) listener();
}
export function recentSuccessfulTargets(values = receipts) {
  const seen = new Set<string>();
  return values
    .filter((receipt) => {
      if (!canResume(receipt)) return false;
      const key = JSON.stringify(receipt.target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, receiptLimits.recentTargets);
}

export function receiptTargetLabel(receipt: OperationReceipt) {
  const target = receipt.target;
  return target?.kind === 'http-url'
    ? target.url
    : target?.kind === 'grpc-target'
      ? target.address
      : target?.target;
}

export function receiptHandoff(receipt: OperationReceipt): PendingHandoffInput | null {
  if (!canResume(receipt)) return null;
  const target = receipt.target;
  const draft: HandoffDraft =
    target.kind === 'http-url'
      ? { kind: 'http-url-draft', target }
      : target.kind === 'grpc-target'
        ? { kind: 'grpc-target-draft', target }
        : {
            kind: receipt.operation === 'path' ? 'path-target-draft' : 'next-hop-target-draft',
            target,
          };
  // Old successful evidence is context for a new manual draft, never fresh proof.
  return {
    provenance: {
      source: 'operation-history',
      quality: 'manual',
      observedAt: new Date().toISOString(),
      evidenceIds: [receipt.id],
    },
    draft,
  };
}

function canResume(receipt: OperationReceipt): receipt is OperationReceipt & { target: TargetRef } {
  return Boolean(
    receipt.target &&
      receipt.outcome === 'success' &&
      (receipt.httpStatus === undefined || receipt.httpStatus < 400) &&
      (receipt.grpcCode === undefined || receipt.grpcCode === 0)
  );
}
