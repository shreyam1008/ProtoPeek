import { createContext, useContext } from 'react';

import type { AppearancePreference, ResolvedAppearance } from '@/shared/theme';

import type { ScanResult } from './api';
import type { HandoffWriteResult } from './app/handoff-store';
import type { PendingHandoffInput } from './app/handoff-types';
import type { InterfacePreferences } from './interface-preferences';

export type RecentDiscovery = ScanResult & { discoveredAt: string };

export type ScanDialogRequest = {
  initialTarget?: string;
  autoStart?: boolean;
};

export const protocolShellEvents = {
  pendingHandoff: 'protopeek:pending-handoff',
} as const;

export function createInitialScanClaim() {
  const claimed = new Set<string>();
  return (target: unknown) => {
    if (typeof target !== 'string' || !target.trim() || claimed.has(target.trim())) return false;
    claimed.add(target.trim());
    return true;
  };
}

export type ProtocolShellValue = {
  appearance: AppearancePreference;
  resolvedAppearance: ResolvedAppearance;
  setAppearance: (appearance: AppearancePreference) => void;
  interfacePreferences: InterfacePreferences;
  setInterfacePreferences: (preferences: InterfacePreferences) => void;
  preferenceStorageError?: string;
  discoveries: RecentDiscovery[];
  openScan: (request?: ScanDialogRequest) => void;
  claimInitialScan?: (target: unknown) => boolean;
  openHandoff: (handoff: PendingHandoffInput) => HandoffWriteResult;
  openGRPCDiscovery: (result: ScanResult) => HandoffWriteResult;
  openHTTPDiscovery: (result: ScanResult) => HandoffWriteResult;
};

export const ProtocolShellContext = createContext<ProtocolShellValue | null>(null);

export function useProtocolShell() {
  const value = useContext(ProtocolShellContext);
  if (!value) throw new Error('Protocol shell context is unavailable.');
  return value;
}
