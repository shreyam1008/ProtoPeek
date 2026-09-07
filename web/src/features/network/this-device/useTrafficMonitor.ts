import { useCallback, useEffect, useRef, useState } from 'react';
import { sampleThisPCTraffic, type ThisPCTrafficSample } from '@/console/this-pc-api';

// Explicit foreground sampling. Keep only the latest result; no overlapping
// requests, timers after Stop, background-tab work, or automatic restart.
export function useTrafficMonitor(duration: 500 | 1000 | 2000) {
  const [running, setRunning] = useState(false);
  const [value, setValue] = useState<ThisPCTrafficSample | null>(null);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wall = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanup = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    if (timer.current) clearTimeout(timer.current);
    if (wall.current) clearTimeout(wall.current);
    timer.current = null;
    wall.current = null;
  }, []);
  const stop = useCallback(
    (reason = 'Live sampling stopped.') => {
      cleanup();
      setRunning(false);
      setMessage(reason);
    },
    [cleanup]
  );
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) stop('Live sampling stopped while this page is hidden.');
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      cleanup();
    };
  }, [cleanup, stop]);

  function start() {
    cleanup();
    if (document.hidden) return;
    const current = generation.current;
    setRunning(true);
    setMessage('Sampling local interface counters. Stops after two minutes or when you leave.');
    wall.current = setTimeout(() => stop('Two-minute sample window finished.'), 120_000);
    async function sample() {
      const request = new AbortController();
      controller.current = request;
      try {
        const next = await sampleThisPCTraffic(duration, request.signal);
        if (generation.current !== current) return;
        setValue(next);
        controller.current = null;
        timer.current = setTimeout(() => void sample(), 1000);
      } catch (error) {
        if (generation.current !== current) return;
        stop(error instanceof Error ? error.message : 'Local sampling failed.');
      }
    }
    void sample();
  }
  function clear() {
    stop('');
    setValue(null);
  }
  return { running, value, message, start, stop, clear };
}
