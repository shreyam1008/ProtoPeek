import { createContext, useContext } from 'react';

import type { ProtoPeekTheme } from '@/shared/theme';

import type { ScanResult } from './api';

export type RecentDiscovery = ScanResult & { discoveredAt: string };

export type ScanDialogRequest = {
  initialTarget?: string;
  autoStart?: boolean;
};

export const protocolShellEvents = {
  openGRPCDiscovery: 'protopeek:open-grpc-discovery',
  openHTTPDiscovery: 'protopeek:open-http-discovery',
} as const;

export type ProtocolShellValue = {
  theme: ProtoPeekTheme;
  setTheme: (theme: ProtoPeekTheme) => void;
  discoveries: RecentDiscovery[];
  openScan: (request?: ScanDialogRequest) => void;
  openGRPCDiscovery: (result: ScanResult) => void;
  openHTTPDiscovery: (result: ScanResult) => void;
};

export const ProtocolShellContext = createContext<ProtocolShellValue | null>(null);

export function useProtocolShell() {
  const value = useContext(ProtocolShellContext);
  if (!value) throw new Error('Protocol shell context is unavailable.');
  return value;
}
