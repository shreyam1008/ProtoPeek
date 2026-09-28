import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchThisPCCapabilities,
  fetchThisPCSnapshot,
  type ThisPCCapabilities,
  type ThisPCSnapshot,
} from '@/console/this-pc-api';

import { deviceErrorMessage, type Resource } from './device-state';

export function useDeviceCapabilities() {
  const [capabilities, setCapabilities] = useState<Resource<ThisPCCapabilities>>({
    status: 'loading',
  });
  const [snapshot, setSnapshot] = useState<Resource<ThisPCSnapshot>>({ status: 'loading' });
  const snapshotControllerRef = useRef<AbortController | null>(null);
  const capabilityControllerRef = useRef<AbortController | null>(null);

  const loadSnapshot = useCallback(() => {
    snapshotControllerRef.current?.abort();
    const controller = new AbortController();
    snapshotControllerRef.current = controller;
    setSnapshot({ status: 'loading' });
    void fetchThisPCSnapshot(controller.signal).then(
      (value) => {
        if (snapshotControllerRef.current === controller && !controller.signal.aborted)
          setSnapshot({ status: 'ready', value });
      },
      (error: unknown) => {
        if (snapshotControllerRef.current !== controller || controller.signal.aborted) return;
        const message = deviceErrorMessage(error, 'Local machine snapshot failed.');
        if (message) setSnapshot({ status: 'error', error: message });
      }
    );
  }, []);

  const loadCapabilities = useCallback(() => {
    capabilityControllerRef.current?.abort();
    const controller = new AbortController();
    capabilityControllerRef.current = controller;
    setCapabilities({ status: 'loading' });
    void fetchThisPCCapabilities(controller.signal).then(
      (value) => {
        if (capabilityControllerRef.current === controller && !controller.signal.aborted)
          setCapabilities({ status: 'ready', value });
      },
      (error: unknown) => {
        if (capabilityControllerRef.current !== controller || controller.signal.aborted) return;
        const message = deviceErrorMessage(error, 'This Device capabilities could not be loaded.');
        if (message) setCapabilities({ status: 'error', error: message });
      }
    );
  }, []);

  useEffect(() => {
    loadCapabilities();
    loadSnapshot();
    return () => {
      capabilityControllerRef.current?.abort();
      snapshotControllerRef.current?.abort();
    };
  }, [loadCapabilities, loadSnapshot]);

  return { capabilities, snapshot, loadSnapshot, loadCapabilities };
}
