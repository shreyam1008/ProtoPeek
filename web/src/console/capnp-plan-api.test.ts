import { afterEach, expect, it, vi } from 'vitest';
import {
  type CapnpPlanStep,
  callCapnpPlan,
  encodeCapnpPlan,
  validateCapnpCall,
  validateCapnpPlan,
} from './capnp-plan-api';

afterEach(() => vi.unstubAllGlobals());
const target = {
  schemaBase64: 'AAAA',
  address: 'localhost:7000',
  transport: 'tcp',
  serverName: '',
  rootCaPem: '',
  timeoutMs: 1000,
};
const steps: CapnpPlanStep[] = [
  { interfaceId: '0x123', ordinal: 0, params: '{"a":9007199254740993}', methodTypes: ['Text'] },
  {
    interfaceId: '0x456',
    ordinal: 1,
    params: '{"b":18446744073709551615}',
    target: { step: 0, path: ['child'] },
  },
];
const evidence = () => ({
  address: target.address,
  transport: target.transport,
  remoteAddress: '127.0.0.1:7000',
  durationMs: 3,
  observedAt: '2026-10-22T12:00:00Z',
  result: { value: 'exact' },
  plan: {
    sentSteps: 2,
    completed: true,
    steps: steps.map((step, index) => ({
      step: index,
      interfaceId: step.interfaceId,
      ordinal: step.ordinal,
      result: { value: 'exact' } as unknown,
      error: undefined as string | undefined,
    })),
  },
});

it('rejects an oversized encoded plan locally before starting transport', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(() =>
    encodeCapnpPlan({ ...target, schemaBase64: 'A'.repeat(4 * 1024 * 1024), steps })
  ).toThrow('4 MiB');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('keeps the native 128-method ceiling and gives single calls request-specific errors', () => {
  expect(() => validateCapnpCall({ ...steps[0], ordinal: 127 })).not.toThrow();
  expect(() => validateCapnpCall({ ...steps[0], ordinal: 200 })).toThrow('Choose a schema method.');
  expect(() => validateCapnpCall({ ...steps[0], params: '[]' })).toThrow(
    'Request JSON must be an object.'
  );
  expect(() => validateCapnpCall({ ...steps[0], methodTypes: [''] })).toThrow(
    'Bind every generic method type.'
  );
});

it('names the malformed plan step without treating it as the main request', () => {
  expect(() => validateCapnpPlan([steps[0], steps[0], { ...steps[0], params: '{bad}' }])).toThrow(
    'Step 3 JSON is invalid.'
  );
});

it('sends original numeric JSON tokens for every explicitly started step', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(evidence()));
  vi.stubGlobal('fetch', fetchMock);
  await callCapnpPlan({ ...target, steps }, new AbortController().signal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const options = fetchMock.mock.calls[0][1] as RequestInit;
  expect(options.body).toContain('"params":{"a":9007199254740993}');
  expect(options.body).toContain('"params":{"b":18446744073709551615}');
  expect(JSON.parse(String(options.body)).steps[1].target).toEqual({ step: 0, path: ['child'] });
});

const invalidPlans: CapnpPlanStep[][] = [
  [],
  Array.from({ length: 9 }, () => steps[0]),
  [{ ...steps[0], params: '[]' }],
  [{ ...steps[0], params: 'null' }],
  [{ ...steps[0], params: '{bad}' }],
  [{ ...steps[0], params: `{"a":"${'x'.repeat(65536)}"}` }],
  [{ ...steps[0], target: { step: 0, path: ['child'] } }],
  [{ ...steps[0], methodTypes: [''] }],
  [{ ...steps[0], typeBindings: { '0x123': ['x'.repeat(513)] } }],
];
it.each(
  invalidPlans.map((steps) => ({ steps }))
)('rejects invalid plans before making any request (%#)', async ({ steps: invalid }) => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    callCapnpPlan({ ...target, steps: invalid }, new AbortController().signal)
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('keeps partial results with terminal peer failure and rejects false completion', async () => {
  const partial = evidence();
  partial.plan.completed = false;
  partial.plan.steps[1] = { ...partial.plan.steps[1], result: null, error: 'peer rejected call' };
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(partial));
  vi.stubGlobal('fetch', fetchMock);
  const result = await callCapnpPlan({ ...target, steps }, new AbortController().signal);
  expect(result.plan?.completed).toBe(false);
  expect(result.plan?.steps[0].result).toEqual({ value: 'exact' });
  expect(result.plan?.steps[1].error).toBe('peer rejected call');
  partial.plan.completed = true;
  fetchMock.mockResolvedValueOnce(Response.json(partial));
  await expect(callCapnpPlan({ ...target, steps }, new AbortController().signal)).rejects.toThrow(
    /completion/
  );
});

it.each([
  'wrong identity',
  'missing step',
  'failure before terminal',
  'no failure',
])('rejects contradictory result evidence: %s', async (kind) => {
  const result = evidence();
  if (kind === 'wrong identity') result.plan.steps[1].interfaceId = '0x999';
  if (kind === 'missing step') result.plan.steps.pop();
  if (kind === 'failure before terminal') result.plan.steps[0].error = 'failed';
  if (kind === 'no failure') result.plan.completed = false;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)));
  await expect(callCapnpPlan({ ...target, steps }, new AbortController().signal)).rejects.toThrow();
});
