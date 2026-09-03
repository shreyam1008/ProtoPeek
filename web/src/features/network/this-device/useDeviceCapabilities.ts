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

  const loadSnapshot = useCallback(() => {
    snapshotControllerRef.current?.abort();
    const controller = new AbortController();
    snapshotControllerRef.current = controller;
    setSnapshot({ status: 'loading' });
    void fetchThisPCSnapshot(controller.signal).then(
      (value) => setSnapshot({ status: 'ready', value }),
      (error: unknown) => {
        const message = deviceErrorMessage(error, 'Local machine snapshot failed.');
        if (message) setSnapshot({ status: 'error', error: message });
      }
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchThisPCCapabilities(controller.signal).then(
      (value) => setCapabilities({ status: 'ready', value }),
      (error: unknown) => {
        const message = deviceErrorMessage(error, 'This Device capabilities could not be loaded.');
        if (message) setCapabilities({ status: 'error', error: message });
      }
    );
    loadSnapshot();
    return () => {
      controller.abort();
      snapshotControllerRef.current?.abort();
    };
  }, [loadSnapshot]);

  return { capabilities, snapshot, loadSnapshot };
}
