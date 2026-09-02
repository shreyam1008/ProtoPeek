import { useEffect, useRef, useState } from 'react';

import {
  startThisPCBenchmark,
  type ThisPCBenchmarkControl,
  type ThisPCBenchmarkProfileID,
  type ThisPCBenchmarkSummary,
  thisPCBenchmarkProfiles,
} from '@/console/this-pc-benchmark';

import { deviceErrorMessage, type QualityPlanStage } from './device-state';

export function useQualityPlan(onOpenView: () => void) {
  const [stage, setStage] = useState<QualityPlanStage>('idle');
  const [summary, setSummary] = useState<ThisPCBenchmarkSummary>({});
  const [phase, setPhase] = useState('');
  const [message, setMessage] = useState('');
  const [profile, setProfile] = useState<ThisPCBenchmarkProfileID>('quick');
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const controlRef = useRef<ThisPCBenchmarkControl | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controlRef.current?.pause();
    },
    []
  );

  function openPlan() {
    controllerRef.current?.abort();
    controlRef.current?.pause();
    controlRef.current = null;
    onOpenView();
    setStage('consent');
    setAcknowledged(false);
    setMessage('');
  }

  async function startPlan() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStage('loading');
    setSummary({});
    setPhase('');
    setMessage('The engine is imported only now, after consent.');
    try {
      const control = await startThisPCBenchmark(profile, uploadEnabled, {
        signal: controller.signal,
        onRunningChange(running) {
          if (running) {
            setStage('running');
            setMessage('One bounded run is active. Results are kept in memory only.');
          }
        },
        onProgress(nextSummary, nextPhase) {
          setSummary(nextSummary);
          setPhase(nextPhase.replace(/([A-Z])/g, ' $1').toLowerCase());
        },
        onFinish(nextSummary) {
          setSummary(nextSummary);
          const hasCompletedMeasurement =
            nextSummary.download !== undefined ||
            nextSummary.upload !== undefined ||
            nextSummary.latency !== undefined;
          setStage(hasCompletedMeasurement ? 'finished' : 'error');
          setMessage(
            hasCompletedMeasurement
              ? 'Completed measurements are shown locally and were not stored.'
              : 'The bounded run ended without a completed quality measurement.'
          );
        },
        onError(nextMessage) {
          setMessage(
            `Measurement warning: ${nextMessage || 'one sample failed; the bounded run is continuing.'}`
          );
        },
        onWallLimit(nextSummary) {
          setSummary(nextSummary);
          setStage('stopped');
          setMessage(
            `The ${thisPCBenchmarkProfiles[profile].wallLimitMs / 1000}-second wall guard paused further work. An already-started request may still settle.`
          );
        },
      });
      controlRef.current = control;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStage('error');
      setMessage(deviceErrorMessage(error, 'The benchmark engine could not start.'));
    }
  }

  function stopPlan() {
    controllerRef.current?.abort();
    controlRef.current?.pause();
    setStage('stopped');
    setMessage(
      'Further measurements were paused. An already-started request may still settle; partial results are not stored.'
    );
  }

  return {
    stage,
    summary,
    phase,
    message,
    profile,
    uploadEnabled,
    acknowledged,
    openPlan,
    setProfile,
    setUploadEnabled,
    setAcknowledged,
    startPlan,
    cancelPlan: () => setStage('idle'),
    stopPlan,
  };
}
