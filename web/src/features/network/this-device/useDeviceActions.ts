import { useEffect, useRef, useState } from 'react';

import {
  fetchThisPCPublicIdentity,
  inspectThisPCActivity,
  sampleThisPCTraffic,
  type ThisPCActivity,
  type ThisPCCapabilities,
  type ThisPCFamily,
  type ThisPCPublicIdentity,
  type ThisPCTrafficSample,
} from '@/console/this-pc-api';

import { deviceErrorMessage, type IdleResource, type Resource } from './device-state';

type DeviceActionKind = 'activity' | 'traffic' | 'public';
type DeviceAction = {
  kind: DeviceActionKind;
  generation: number;
  controller: AbortController;
};

export function useDeviceActions(capabilities: Resource<ThisPCCapabilities>) {
  const [activity, setActivity] = useState<IdleResource<ThisPCActivity>>({ status: 'idle' });
  const [activityConsent, setActivityConsent] = useState(false);
  const [activityAcknowledged, setActivityAcknowledged] = useState(false);
  const [activityPurpose, setActivityPurpose] = useState<'listeners' | 'connections'>('listeners');
  const [traffic, setTraffic] = useState<IdleResource<ThisPCTrafficSample>>({ status: 'idle' });
  const [selectedTrafficDuration, setTrafficDuration] = useState<500 | 1000 | 2000>(1000);
  const [publicIdentity, setPublicIdentity] = useState<IdleResource<ThisPCPublicIdentity>>({
    status: 'idle',
  });
  const [publicConsent, setPublicConsent] = useState(false);
  const [publicAcknowledged, setPublicAcknowledged] = useState(false);
  const [publicFamilies, setPublicFamilies] = useState<ThisPCFamily[]>(['ipv4', 'ipv6']);
  const mountedRef = useRef(false);
  const actionGenerationRef = useRef(0);
  const actionControllerRef = useRef<DeviceAction | null>(null);
  const supportedDurations =
    capabilities.status === 'ready' ? capabilities.value.trafficSample.durationsMs : [];
  const trafficDuration =
    supportedDurations.length && !supportedDurations.includes(selectedTrafficDuration)
      ? supportedDurations[0]
      : selectedTrafficDuration;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionGenerationRef.current += 1;
      const action = actionControllerRef.current;
      actionControllerRef.current = null;
      action?.controller.abort();
    };
  }, []);

  function returnActionToIdle(kind: DeviceActionKind) {
    if (kind === 'activity') {
      setActivity((current) => (current.status === 'loading' ? { status: 'idle' } : current));
      return;
    }
    if (kind === 'traffic') {
      setTraffic((current) => (current.status === 'loading' ? { status: 'idle' } : current));
      return;
    }
    setPublicIdentity((current) => (current.status === 'loading' ? { status: 'idle' } : current));
  }

  function beginAction(kind: DeviceActionKind) {
    const previous = actionControllerRef.current;
    actionControllerRef.current = null;
    const generation = actionGenerationRef.current + 1;
    actionGenerationRef.current = generation;
    if (previous) {
      returnActionToIdle(previous.kind);
      previous.controller.abort();
    }
    const action = { kind, generation, controller: new AbortController() };
    actionControllerRef.current = action;
    return action;
  }

  function actionIsCurrent(action: DeviceAction) {
    return (
      mountedRef.current &&
      actionControllerRef.current === action &&
      actionGenerationRef.current === action.generation &&
      !action.controller.signal.aborted
    );
  }

  function settleAction(action: DeviceAction, commit: () => void) {
    if (!actionIsCurrent(action)) return;
    actionControllerRef.current = null;
    commit();
  }

  function openActivityConsent(purpose: 'listeners' | 'connections') {
    setActivityPurpose(purpose);
    setActivityAcknowledged(false);
    setActivityConsent(true);
  }

  function inspectActivity() {
    setActivityConsent(false);
    setActivityAcknowledged(false);
    const action = beginAction('activity');
    setActivity({ status: 'loading' });
    void inspectThisPCActivity(action.controller.signal).then(
      (value) => settleAction(action, () => setActivity({ status: 'ready', value })),
      (error: unknown) => {
        const message = deviceErrorMessage(error, 'Local activity inspection failed.');
        settleAction(action, () =>
          setActivity(message ? { status: 'error', error: message } : { status: 'idle' })
        );
      }
    );
  }

  function sampleTraffic() {
    const action = beginAction('traffic');
    setTraffic({ status: 'loading' });
    void sampleThisPCTraffic(trafficDuration, action.controller.signal).then(
      (value) => settleAction(action, () => setTraffic({ status: 'ready', value })),
      (error: unknown) => {
        const message = deviceErrorMessage(error, 'Local traffic sample failed.');
        settleAction(action, () =>
          setTraffic(message ? { status: 'error', error: message } : { status: 'idle' })
        );
      }
    );
  }

  function checkPublicIdentity() {
    setPublicConsent(false);
    setPublicAcknowledged(false);
    const action = beginAction('public');
    setPublicIdentity({ status: 'loading' });
    void fetchThisPCPublicIdentity(publicFamilies, action.controller.signal).then(
      (value) => settleAction(action, () => setPublicIdentity({ status: 'ready', value })),
      (error: unknown) => {
        const message = deviceErrorMessage(error, 'Public identity check failed.');
        settleAction(action, () =>
          setPublicIdentity(message ? { status: 'error', error: message } : { status: 'idle' })
        );
      }
    );
  }

  function openPublicConsent() {
    setPublicAcknowledged(false);
    setPublicConsent(true);
  }

  return {
    activity,
    activityConsent,
    activityAcknowledged,
    activityPurpose,
    traffic,
    trafficDuration,
    publicIdentity,
    publicConsent,
    publicAcknowledged,
    publicFamilies,
    openActivityConsent,
    setActivityAcknowledged,
    setActivityConsent,
    inspectActivity,
    setTrafficDuration,
    sampleTraffic,
    openPublicConsent,
    setPublicAcknowledged,
    setPublicConsent,
    setPublicFamilies,
    checkPublicIdentity,
  };
}
