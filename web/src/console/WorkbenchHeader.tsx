import { LockKeyhole, Menu, RefreshCw, Server } from 'lucide-react';
import type { RefObject } from 'react';

import type { BootstrapMethod, WorkspaceTargetProfile } from '@/shared/types';
import { modifierKeyLabel } from '@/shared/utils';

import { ProtoPeekMark } from './ProtoPeekMark';

function methodMode(method: BootstrapMethod) {
  if (method.clientStreaming && method.serverStreaming) return 'Bidirectional stream';
  if (method.clientStreaming) return 'Client stream';
  if (method.serverStreaming) return 'Server stream';
  return 'Unary';
}

export function WorkbenchHeader({
  target,
  targetProfile,
  serviceName,
  method,
  sidebarButtonRef,
  sidebarOpen,
  onOpenSidebar,
  onOpenCommandPalette,
  onSwitchTarget,
}: {
  target: string;
  targetProfile: WorkspaceTargetProfile | null;
  serviceName: string;
  method: BootstrapMethod;
  sidebarButtonRef: RefObject<HTMLButtonElement | null>;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onOpenCommandPalette: () => void;
  onSwitchTarget: () => void;
}) {
  const source = targetProfile?.schemaSource ?? 'reflection';
  const transport = targetProfile?.plaintext === false ? 'TLS' : 'Plaintext';
  const modifier = modifierKeyLabel();

  return (
    <header className="pp-workbench-header">
      <button
        ref={sidebarButtonRef}
        type="button"
        className="pp-mobile-nav-button"
        aria-label="Open service navigation"
        aria-expanded={sidebarOpen}
        onClick={onOpenSidebar}
      >
        <Menu aria-hidden="true" />
      </button>
      <div className="pp-mobile-brand" aria-hidden="true">
        <ProtoPeekMark />
      </div>
      <button type="button" className="pp-target-switch" onClick={onSwitchTarget}>
        <Server aria-hidden="true" />
        <span>{target}</span>
        <RefreshCw aria-hidden="true" />
      </button>
      <span className="pp-connection-fact">
        <LockKeyhole aria-hidden="true" /> Local only
      </span>
      <span className="pp-connection-fact">{transport}</span>
      <span className="pp-connection-fact pp-source-fact">{source}</span>
      <div className="pp-method-identity">
        <span>{serviceName}</span>
        <strong>{method.name}</strong>
        <small>{methodMode(method)}</small>
      </div>
      <button
        type="button"
        className="pp-command-trigger"
        aria-label="Open command palette"
        onClick={onOpenCommandPalette}
      >
        <span>Commands</span>
        <kbd>{modifier} K</kbd>
      </button>
    </header>
  );
}
