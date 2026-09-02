import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchTunnelCapabilities,
  fetchTunnelSnapshot,
  TunnelAPIError,
  type TunnelCapabilities,
  type TunnelSnapshot,
} from '@/console/tunnels-api';

export function useCloudflareObservation(onSelectionReconciled: () => void) {
  const [capabilities, setCapabilities] = useState<TunnelCapabilities | null>(null);
  const [snapshot, setSnapshot] = useState<TunnelSnapshot | null>(null);
  const [selectedID, setSelectedID] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const selectedIDRef = useRef('');
  const reconcileSelectionRef = useRef(onSelectionReconciled);
  reconcileSelectionRef.current = onSelectionReconciled;

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setRefreshing(true);
    try {
      const [nextCapabilities, nextSnapshot] = await Promise.all([
        fetchTunnelCapabilities(controller.signal),
        fetchTunnelSnapshot(controller.signal),
      ]);
      if (!mountedRef.current || controller.signal.aborted) return;
      setCapabilities(nextCapabilities);
      setSnapshot(nextSnapshot);
      setError('');
      const nextSelectedID =
        selectedIDRef.current &&
        nextSnapshot.deployments.some((deployment) => deployment.id === selectedIDRef.current)
          ? selectedIDRef.current
          : (nextSnapshot.deployments[0]?.id ?? '');
      if (nextSelectedID !== selectedIDRef.current) reconcileSelectionRef.current();
      selectedIDRef.current = nextSelectedID;
      setSelectedID(nextSelectedID);
    } catch (cause) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (cause instanceof TunnelAPIError && (cause.status === 403 || cause.status === 404)) {
        setError(
          'Tunnel inspection is unavailable in this runtime. Start ProtoPeek in local browser mode to use it.'
        );
      } else {
        setError(
          cause instanceof Error && cause.message
            ? cause.message.slice(0, 2 * 1024)
            : 'Tunnel evidence could not be loaded.'
        );
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const selectDeployment = useCallback((id: string) => {
    selectedIDRef.current = id;
    setSelectedID(id);
  }, []);
  const getSelectedID = useCallback(() => selectedIDRef.current, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  return {
    capabilities,
    error,
    getSelectedID,
    load,
    loading,
    refreshing,
    selectedID,
    selectDeployment,
    snapshot,
  };
}
