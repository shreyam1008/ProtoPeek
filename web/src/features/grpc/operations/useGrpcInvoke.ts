import { useEffect, useRef, useState } from 'react';
import { invokeMethod, invokeWorkspaceMethod } from '@/console/api';
import type { WorkbenchView } from '@/console/ServiceNavigator';
import type {
  AssertionResult,
  AssertionRule,
  BootstrapMethod,
  BootstrapService,
  InvokeRequest,
  InvokeResponse,
  MetadataEntry,
  RequestHistoryEntry,
  SchemaResponse,
} from '@/shared/types';
import {
  evaluateAssertions,
  filterMetadataForInvoke,
  safeParseJson,
  toHistoryEntry,
} from '@/shared/utils';
import type { OperationMessage } from '../workspace/model';

export type InvokeState = {
  loading: boolean;
  error: string | null;
  result: InvokeResponse | null;
  latencyMs: number;
};

const idleInvokeState: InvokeState = {
  loading: false,
  error: null,
  result: null,
  latencyMs: 0,
};

type UseGrpcInvokeOptions = {
  schema: SchemaResponse | null;
  service: BootstrapService | null;
  method: BootstrapMethod | null;
  workspaceSessionId: string;
  requestText: string;
  timeoutSeconds: number;
  metadata: MetadataEntry[];
  assertionRules: AssertionRule[];
  replayScope: { targetId?: string; targetAddress: string };
  setHistory: React.Dispatch<React.SetStateAction<RequestHistoryEntry[]>>;
  setOperationMessage: React.Dispatch<React.SetStateAction<OperationMessage | null>>;
  setActiveView: React.Dispatch<React.SetStateAction<WorkbenchView>>;
};

export function useGrpcInvoke({
  schema,
  service,
  method,
  workspaceSessionId,
  requestText,
  timeoutSeconds,
  metadata,
  assertionRules,
  replayScope,
  setHistory,
  setOperationMessage,
  setActiveView,
}: UseGrpcInvokeOptions) {
  const [state, setState] = useState<InvokeState>(idleInvokeState);
  const [assertionResults, setAssertionResults] = useState<AssertionResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      const active = abortRef.current;
      abortRef.current = null;
      active?.abort();
    },
    []
  );

  function cancelSilently() {
    const active = abortRef.current;
    abortRef.current = null;
    active?.abort();
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function reset() {
    setState(idleInvokeState);
    setAssertionResults([]);
  }

  function clearResult() {
    setState(idleInvokeState);
  }

  async function run() {
    if (!schema || !service || !method) return;
    const parsed = safeParseJson(requestText);
    if (parsed.error) {
      setAssertionResults([]);
      setState({ loading: false, error: parsed.error, result: null, latencyMs: 0 });
      setActiveView('compose');
      return;
    }
    if (schema.requestStream && !Array.isArray(parsed.value)) {
      setAssertionResults([]);
      setState({
        loading: false,
        error: 'Streaming RPCs need a JSON array.',
        result: null,
        latencyMs: 0,
      });
      setActiveView('compose');
      return;
    }
    if (!schema.requestStream && Array.isArray(parsed.value)) {
      setAssertionResults([]);
      setState({
        loading: false,
        error: 'Unary RPCs need a single object.',
        result: null,
        latencyMs: 0,
      });
      setActiveView('compose');
      return;
    }

    const payload: InvokeRequest = {
      timeout_seconds: timeoutSeconds,
      metadata: filterMetadataForInvoke(metadata),
      data: schema.requestStream ? (parsed.value as unknown[]) : [parsed.value],
    };
    if (payload.metadata.length < metadata.filter((entry) => entry.name.trim()).length) {
      setOperationMessage({
        tone: 'info',
        title: 'Sensitive metadata omitted',
        description:
          'Blank or [redacted] sensitive metadata was not sent. Re-enter the value to include it in a later RPC.',
      });
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ loading: true, error: null, result: null, latencyMs: 0 });
    setActiveView('compose');
    const startedAt = performance.now();
    try {
      const result = workspaceSessionId
        ? await invokeWorkspaceMethod(
            workspaceSessionId,
            method.fullName,
            payload,
            controller.signal
          )
        : await invokeMethod(method.fullName, payload, controller.signal);
      if (abortRef.current !== controller) return;
      if (controller.signal.aborted) throw new DOMException('Invocation cancelled.', 'AbortError');
      const latencyMs = performance.now() - startedAt;
      setState({ loading: false, error: null, result, latencyMs });
      setAssertionResults(evaluateAssertions({ rules: assertionRules, result, latencyMs }));
      setHistory((current) =>
        [
          toHistoryEntry({
            service: service.name,
            method: method.fullName,
            latencyMs,
            success: !result.error && !result.localLimit,
            requestText,
            response:
              result.responses[0]?.message ?? result.error ?? result.localLimit?.message ?? null,
            metadata,
            timeoutSeconds,
            ...replayScope,
          }),
          ...current,
        ].slice(0, 50)
      );
    } catch (error) {
      if (abortRef.current !== controller) return;
      setAssertionResults([]);
      setState({
        loading: false,
        error:
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Invocation cancelled.'
            : error instanceof Error
              ? error.message
              : 'Invocation failed.',
        result: null,
        latencyMs: 0,
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return {
    assertionResults,
    isActive: () => Boolean(abortRef.current),
    state,
    cancel,
    cancelSilently,
    clearResult,
    reset,
    run,
  };
}
