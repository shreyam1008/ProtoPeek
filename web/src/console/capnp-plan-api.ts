import { type CapnpResult, requestCapnp } from './capnp-api';

export type CapnpBindings = { typeBindings?: Record<string, string[]>; methodTypes?: string[] };
export type CapnpPlanStep = CapnpBindings & {
  interfaceId: string;
  ordinal: number;
  params: string;
  target?: { step: number; path: string[] };
};
export type CapnpPlanTarget = {
  schemaBase64: string;
  address: string;
  transport: string;
  serverName: string;
  rootCaPem: string;
  timeoutMs: number;
};

export function validateCapnpPlan(steps: CapnpPlanStep[]) {
  if (!steps.length || steps.length > 8) throw new Error('A call plan needs 1–8 steps.');
  for (const [index, step] of steps.entries()) {
    if (
      !/^0x[\da-f]{1,16}$/i.test(step.interfaceId) ||
      !Number.isInteger(step.ordinal) ||
      step.ordinal < 0 ||
      step.ordinal > 127
    )
      throw new Error(`Choose a schema method for step ${index + 1}.`);
    if (new TextEncoder().encode(step.params).byteLength > 65536)
      throw new Error(`Step ${index + 1} JSON exceeds 64 KiB.`);
    const params = JSON.parse(step.params);
    if (!params || typeof params !== 'object' || Array.isArray(params))
      throw new Error(`Step ${index + 1} JSON must be an object.`);
    if (
      step.target &&
      (!Number.isInteger(step.target.step) ||
        step.target.step < 0 ||
        step.target.step >= index ||
        !step.target.path.length ||
        step.target.path.length > 8 ||
        step.target.path.some((name) => !/^\w{1,128}$/.test(name)))
    )
      throw new Error(`Step ${index + 1} must use a named capability from an earlier step.`);
    if (
      step.methodTypes &&
      (step.methodTypes.length > 64 ||
        step.methodTypes.some((name) => !name.trim() || name.length > 512))
    )
      throw new Error(`Bind every generic method type in step ${index + 1}.`);
    if (
      step.typeBindings &&
      (Object.keys(step.typeBindings).length > 64 ||
        Object.entries(step.typeBindings).some(
          ([scope, types]) =>
            !/^0x[\da-f]{1,16}$/i.test(scope) ||
            types.length > 64 ||
            types.some((name) => !name.trim() || name.length > 512)
        ))
    )
      throw new Error(`Invalid generic scope bindings in step ${index + 1}.`);
  }
}

export async function callCapnpPlan(
  input: CapnpPlanTarget & { steps: CapnpPlanStep[] },
  signal: AbortSignal
): Promise<CapnpResult> {
  validateCapnpPlan(input.steps);
  const { steps, ...target } = input;
  // Preserve original JSON tokens, including exact unquoted 64-bit integers.
  const encoded = steps.map(
    ({ params, ...step }) => `${JSON.stringify(step).slice(0, -1)},"params":${params}}`
  );
  const body = `${JSON.stringify(target).slice(0, -1)},"steps":[${encoded.join(',')}]}`;
  if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024)
    throw new Error('Call plan and compiled schema exceed 4 MiB.');
  const data = await requestCapnp('call', input, signal, 768 * 1024, body);
  if (
    !data ||
    data.address !== input.address ||
    data.transport !== input.transport ||
    typeof data.remoteAddress !== 'string' ||
    data.remoteAddress.length > 320 ||
    !Number.isFinite(data.durationMs) ||
    data.durationMs < 0 ||
    typeof data.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(data.observedAt)) ||
    !data.plan ||
    data.plan.sentSteps !== steps.length ||
    typeof data.plan.completed !== 'boolean' ||
    !Array.isArray(data.plan.steps) ||
    !data.plan.steps.length ||
    data.plan.steps.length > steps.length
  )
    throw new Error('Invalid call plan result.');
  for (const [index, result] of data.plan.steps.entries()) {
    if (
      !result ||
      result.step !== index ||
      result.interfaceId !== steps[index]?.interfaceId ||
      result.ordinal !== steps[index]?.ordinal ||
      !Object.hasOwn(result, 'result') ||
      (result.error !== undefined &&
        (typeof result.error !== 'string' ||
          !result.error ||
          result.error.length > 4096 ||
          index !== data.plan.steps.length - 1 ||
          result.result !== null))
    )
      throw new Error('Invalid call plan step evidence.');
  }
  if (
    data.plan.completed &&
    (data.plan.steps.length !== steps.length ||
      data.plan.steps.some((step: { error?: string }) => step.error))
  )
    throw new Error('Call plan claims completion without all results.');
  if (!data.plan.completed && !data.plan.steps.at(-1)?.error)
    throw new Error('Incomplete call plan has no failure evidence.');
  return data;
}
