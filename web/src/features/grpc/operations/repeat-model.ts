import type { RepeatConfig, RepeatStopReason } from '@/shared/types';

export const repeatAggregateLimitMs = 60_000;
export const repeatErrorMessageLimit = 2048;

export const defaultRepeat: RepeatConfig = {
  count: 5,
  thinkTimeMs: 0,
  deadlineSeconds: 5,
};

export const repeatPresets: Array<{ label: string; config: RepeatConfig }> = [
  { label: 'Quick', config: { count: 5, thinkTimeMs: 0, deadlineSeconds: 5 } },
  { label: 'Tail sample', config: { count: 20, thinkTimeMs: 0, deadlineSeconds: 5 } },
  { label: 'Paced', config: { count: 20, thinkTimeMs: 250, deadlineSeconds: 5 } },
];

export type ActiveRepeat = {
  controller: AbortController;
  stopReason: RepeatStopReason | null;
};

function repeatAbortError() {
  return new DOMException('Repeat cancelled.', 'AbortError');
}

export function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(repeatAbortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(repeatAbortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}

export function waitForRepeatDelay(delayMs: number, signal: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(repeatAbortError());
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      window.clearTimeout(timer);
      reject(repeatAbortError());
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function boundedRepeatError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : '';
  return (message || fallback).slice(0, repeatErrorMessageLimit);
}
