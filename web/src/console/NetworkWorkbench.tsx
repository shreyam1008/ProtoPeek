import { NetworkRoute } from '@/features/network/NetworkRoute';

import type { NetworkStore } from './network-store';
import './network.css';

export function NetworkWorkbench(props: { store?: NetworkStore }) {
  return <NetworkRoute {...props} />;
}
