import { useMemo, useState } from 'react';
import type { CapnpMethod, CapnpSchema } from './capnp-api';
import { type CapnpBindings, type CapnpPlanStep, validateCapnpPlan } from './capnp-plan-api';
import './capnp-plan.css';

const keyFor = (method: Pick<CapnpMethod, 'interfaceId' | 'ordinal'>) =>
  `${method.interfaceId}/${method.ordinal}`;

function TypeBindings({
  method,
  value,
  onChange,
  disabled,
  labelPrefix,
}: {
  method: CapnpMethod;
  value: CapnpBindings;
  onChange: (value: CapnpBindings) => void;
  disabled: boolean;
  labelPrefix: string;
}) {
  if (!method.typeParameters?.length && !method.implicitParameters?.length) return null;
  return (
    <fieldset className="pp-capnp-bindings" disabled={disabled}>
      <legend>Generic type bindings</legend>
      <p>
        Use Text, Data, List(UInt32), AnyPointer, or a schema struct/interface ID. Generic node
        arguments use 0xID(Text). Leave a whole scope empty to infer it; otherwise bind every field
        explicitly. Values stay in this editor.
      </p>
      {(method.typeParameters ?? []).map((parameter) => (
        <label key={`${parameter.scopeId}/${parameter.index}`}>
          {parameter.name}{' '}
          <small>
            {parameter.scopeId} · parameter {parameter.index + 1}
          </small>
          <input
            aria-label={`${labelPrefix} type ${parameter.name} in ${parameter.scopeId}`}
            maxLength={512}
            placeholder="Empty scope infers types"
            value={value.typeBindings?.[parameter.scopeId]?.[parameter.index] ?? ''}
            onChange={(event) => {
              const count =
                Math.max(
                  ...(method.typeParameters ?? [])
                    .filter((item) => item.scopeId === parameter.scopeId)
                    .map((item) => item.index)
                ) + 1;
              const types = Array.from(
                { length: count },
                (_, index) => value.typeBindings?.[parameter.scopeId]?.[index] ?? ''
              );
              types[parameter.index] = event.target.value;
              const typeBindings = { ...value.typeBindings };
              if (types.every((type) => !type.trim())) delete typeBindings[parameter.scopeId];
              else typeBindings[parameter.scopeId] = types;
              const next = { ...value };
              if (Object.keys(typeBindings).length) next.typeBindings = typeBindings;
              else delete next.typeBindings;
              onChange(next);
            }}
          />
        </label>
      ))}
      {(method.implicitParameters ?? []).map((name, index) => (
        <label key={name}>
          Method type {name}
          <input
            aria-label={`${labelPrefix} method type ${name}`}
            maxLength={512}
            placeholder="Choose a concrete pointer type"
            value={value.methodTypes?.[index] ?? ''}
            onChange={(event) => {
              const types = Array.from(
                { length: method.implicitParameters?.length ?? 0 },
                (_, n) => value.methodTypes?.[n] ?? ''
              );
              types[index] = event.target.value;
              onChange({ ...value, methodTypes: types });
            }}
          />
        </label>
      ))}
    </fieldset>
  );
}

type Row = {
  id: number;
  method: string;
  params: string;
  target: number;
  path: string;
  bindings: CapnpBindings;
};

export function CapnpAdvancedPanel({
  schema,
  method,
  params,
  bindings,
  onBindingsChange,
  onRun,
  busy,
  executionIdentity,
  targetLabel,
}: {
  schema: CapnpSchema;
  method: CapnpMethod;
  params: string;
  bindings: CapnpBindings;
  onBindingsChange: (value: CapnpBindings) => void;
  onRun: (steps: CapnpPlanStep[]) => void;
  busy: boolean;
  executionIdentity: string;
  targetLabel: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const planRows: Row[] = [
    { id: 1, method: keyFor(method), params, target: -1, path: '', bindings },
    ...rows,
  ];
  const reviewIdentity = useMemo(
    () => JSON.stringify([executionIdentity, keyFor(method), params, bindings]),
    [executionIdentity, method, params, bindings]
  );
  const [reviewed, setReviewed] = useState<{ steps: CapnpPlanStep[]; identity: string } | null>(
    null
  );
  const [error, setError] = useState('');

  function update(index: number, value: Partial<Row>) {
    setRows((current) => current.map((row, n) => (n + 1 === index ? { ...row, ...value } : row)));
    setReviewed(null);
    setError('');
  }
  function review() {
    try {
      const steps = planRows.map((row) => {
        const chosen = schema.methods.find((candidate) => keyFor(candidate) === row.method);
        if (!chosen) throw new Error('Choose a schema method for every step.');
        const methodTypes = chosen.implicitParameters?.length
          ? Array.from(
              { length: chosen.implicitParameters.length },
              (_, index) => row.bindings.methodTypes?.[index] ?? ''
            )
          : undefined;
        return {
          interfaceId: chosen.interfaceId,
          ordinal: chosen.ordinal,
          params: row.params,
          ...row.bindings,
          methodTypes,
          ...(row.target >= 0
            ? { target: { step: row.target, path: row.path.split('.').map((name) => name.trim()) } }
            : {}),
        };
      });
      validateCapnpPlan(steps);
      setReviewed({ steps, identity: reviewIdentity });
      setError('');
    } catch (cause) {
      setReviewed(null);
      setError(cause instanceof Error ? cause.message : 'Unable to review the call plan.');
    }
  }
  return (
    <section className="pp-capnp-advanced" aria-label="Cap’n Proto advanced calls">
      <TypeBindings
        method={method}
        value={bindings}
        onChange={onBindingsChange}
        disabled={busy}
        labelPrefix="Selected method"
      />
      <details>
        <summary>Capability call plan · up to 8 steps</summary>
        <p>
          Prepare calls on the bootstrap object or a capability returned by an earlier step. Calls
          are pipelined on one connection with the selected total timeout and 4 MiB wire budget in
          each direction. Sent calls may take effect even if a later call fails.
        </p>
        {planRows.map((row, index) => {
          const chosen = schema.methods.find((candidate) => keyFor(candidate) === row.method);
          const prior = planRows[row.target];
          const priorMethod = prior
            ? schema.methods.find((candidate) => keyFor(candidate) === prior.method)
            : undefined;
          return (
            <fieldset key={row.id} disabled={busy} className="pp-capnp-plan-step">
              <legend>Step {index + 1}</legend>
              {index === 0 ? (
                <p>
                  Uses the selected method, {method.name}, with its current generic bindings and the
                  Request JSON below.
                </p>
              ) : (
                <>
                  <label>
                    Method
                    <select
                      aria-label={`Step ${index + 1} method`}
                      value={row.method}
                      onChange={(event) =>
                        update(index, { method: event.target.value, params: '{}', bindings: {} })
                      }
                    >
                      {schema.methods.map((item) => (
                        <option key={keyFor(item)} value={keyFor(item)}>
                          {item.interfaceName.split(':').at(-1)} · {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Target
                    <select
                      aria-label={`Step ${index + 1} target`}
                      value={row.target}
                      onChange={(event) => {
                        const target = Number(event.target.value);
                        const prior = planRows[target];
                        const candidate = schema.methods.find(
                          (item) => prior && keyFor(item) === prior.method
                        )?.resultCapabilities?.[0];
                        update(index, { target, path: candidate?.path.join('.') ?? '' });
                      }}
                    >
                      <option value={-1}>Bootstrap object</option>
                      {planRows.slice(0, index).map((prior, n) => (
                        <option key={prior.id} value={n}>
                          Capability from step {n + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  {row.target >= 0 ? (
                    <label>
                      Returned capability field
                      <input
                        aria-label={`Step ${index + 1} capability path`}
                        value={row.path}
                        maxLength={1031}
                        placeholder={
                          priorMethod?.resultCapabilities?.[0]?.path.join('.') ?? 'result.field'
                        }
                        onChange={(event) => update(index, { path: event.target.value })}
                      />
                      <small>
                        Named struct fields separated by dots. Lists and union branches cannot be
                        pipelined.
                      </small>
                    </label>
                  ) : null}
                  {chosen ? (
                    <TypeBindings
                      method={chosen}
                      value={row.bindings}
                      onChange={(value) => update(index, { bindings: value })}
                      disabled={busy}
                      labelPrefix={`Step ${index + 1}`}
                    />
                  ) : null}
                  <label>
                    Request JSON
                    <textarea
                      aria-label={`Step ${index + 1} request JSON`}
                      value={row.params}
                      maxLength={65536}
                      rows={3}
                      spellCheck={false}
                      onChange={(event) => update(index, { params: event.target.value })}
                    />
                  </label>
                </>
              )}
            </fieldset>
          );
        })}
        <div className="pp-capnp-plan-actions">
          <button
            type="button"
            disabled={busy || planRows.length >= 8}
            onClick={() => {
              setRows((current) => [
                ...current,
                {
                  id: (current.at(-1)?.id ?? 1) + 1,
                  method: keyFor(method),
                  params: '{}',
                  target: -1,
                  path: '',
                  bindings: {},
                },
              ]);
              setReviewed(null);
            }}
          >
            Add step
          </button>
          <button
            type="button"
            disabled={busy || planRows.length <= 1}
            onClick={() => {
              setRows((current) => current.slice(0, -1));
              setReviewed(null);
            }}
          >
            Remove last step
          </button>
          <button type="button" disabled={busy} onClick={review}>
            Review plan
          </button>
        </div>
        {error ? (
          <p role="alert" className="pp-capnp-error">
            {error}
          </p>
        ) : null}
        {reviewed?.identity === reviewIdentity ? (
          <section aria-label="Reviewed capability plan">
            <p>{targetLabel}</p>
            <p>
              {reviewed.steps.length} prepared calls · one connection · no connection made during
              review.
            </p>
            <ol>
              {reviewed.steps.map((step, index) => (
                <li key={planRows[index]?.id}>
                  Step {index + 1}: {step.interfaceId} / {step.ordinal} ·{' '}
                  {step.target
                    ? `step ${step.target.step + 1}: ${step.target.path.join('.')}`
                    : 'bootstrap'}{' '}
                  · {new TextEncoder().encode(step.params).byteLength} request bytes
                </li>
              ))}
            </ol>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onRun(reviewed.steps);
                setReviewed(null);
              }}
            >
              Run reviewed plan
            </button>
          </section>
        ) : null}
      </details>
    </section>
  );
}
