import { readBoundedText } from '@/shared/bounded-response';

export type CanonicalRoute = { hostname: string; path: string; service: string };
export type CanonicalPlan = {
  id: string;
  path: string;
  beforeRevision: string;
  afterRevision: string;
  route: CanonicalRoute;
  expiresAt: string;
  applied: boolean;
};
export type CanonicalResult = {
  operation: string;
  status: string;
  message: string;
  observedAt: string;
  plan?: CanonicalPlan;
  receipt?: { id: string; status: string; beforeRevision: string; afterRevision: string };
  data?: unknown;
};
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function text(value: unknown, limit = 4096): value is string {
  return typeof value === 'string' && value.length <= limit;
}
export async function canonicalOperation(
  request: {
    operation: string;
    configPath: string;
    revision: string;
    url?: string;
    route?: CanonicalRoute;
    planId?: string;
    confirmed?: boolean;
  },
  signal: AbortSignal
): Promise<CanonicalResult> {
  const response = await fetch(new URL('api/tunnels/operation', window.location.href), {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token':
        document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '',
    },
    body: JSON.stringify(request),
  });
  const body = await readBoundedText(response, 128 * 1024);
  if (body.truncated)
    throw new Error(
      'Canonical operation response exceeded its safety limit. Refresh host before retrying.'
    );
  if (!response.ok)
    throw new Error(
      `Canonical operation unavailable (${response.status}). Refresh host before retrying.`
    );
  const value: unknown = JSON.parse(body.text);
  if (
    !record(value) ||
    !text(value.operation, 16) ||
    !text(value.status, 32) ||
    !text(value.message) ||
    !text(value.observedAt, 64)
  )
    throw new Error('Invalid canonical operation response.');
  if (value.plan !== undefined) {
    const plan = value.plan;
    if (
      !record(plan) ||
      !text(plan.id, 64) ||
      !text(plan.path) ||
      !text(plan.beforeRevision, 64) ||
      !text(plan.afterRevision, 64) ||
      !text(plan.expiresAt, 64) ||
      typeof plan.applied !== 'boolean' ||
      !record(plan.route) ||
      !text(plan.route.hostname, 253) ||
      !text(plan.route.path, 1024) ||
      !text(plan.route.service, 2048)
    )
      throw new Error('Invalid canonical config plan.');
  }
  if (value.receipt !== undefined) {
    const receipt = value.receipt;
    if (
      !record(receipt) ||
      !text(receipt.id, 64) ||
      !text(receipt.status, 32) ||
      !text(receipt.beforeRevision, 64) ||
      !text(receipt.afterRevision, 64)
    )
      throw new Error('Invalid config receipt. Refresh host before retrying.');
  }
  return value as CanonicalResult;
}
