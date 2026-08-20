import { Radar, X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { AccessibleTabs, TabPanel } from './AccessibleTabs';
import type { ScanResult } from './api';
import { DiscoveryScanner } from './DiscoveryScanner';
import { NmapImportPanel } from './NmapImportPanel';

export function ScanTargetDialog({
  open,
  initialTarget = '',
  autoStart = false,
  onClose,
  onResults,
  onOpenGRPC,
  onOpenHTTP,
}: {
  open: boolean;
  initialTarget?: string;
  autoStart?: boolean;
  onClose: () => void;
  onResults: (results: ScanResult[]) => void;
  onOpenGRPC: (result: ScanResult) => void;
  onOpenHTTP: (result: ScanResult) => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<'probe' | 'nmap'>('probe');
  const closeDialog = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => inputRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => !element.closest('[hidden]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="pp-scan-dialog-layer">
      <button
        type="button"
        className="pp-scan-dialog-backdrop"
        aria-label="Close scan target dialog"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="pp-scan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-target-title"
      >
        <header>
          <div>
            <span>
              <Radar aria-hidden="true" /> Safe discovery
            </span>
            <h2 id="scan-target-title">Scan target</h2>
          </div>
          <button type="button" aria-label="Close scan target dialog" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <AccessibleTabs
          id="scan-target-mode"
          label="Discovery source"
          tabs={[
            { value: 'probe', label: 'Probe target' },
            { value: 'nmap', label: 'Import Nmap XML' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
          className="pp-scan-source-tabs"
        />
        <TabPanel id="scan-target-mode" tab="probe" active={activeTab === 'probe'}>
          <DiscoveryScanner
            inputRef={inputRef}
            initialTarget={initialTarget}
            autoStart={autoStart}
            onResults={onResults}
            onOpenGRPC={onOpenGRPC}
            onOpenHTTP={onOpenHTTP}
          />
        </TabPanel>
        <TabPanel id="scan-target-mode" tab="nmap" active={activeTab === 'nmap'}>
          <NmapImportPanel
            active={activeTab === 'nmap'}
            onResults={onResults}
            onOpenGRPC={onOpenGRPC}
            onOpenHTTP={onOpenHTTP}
          />
        </TabPanel>
        <footer>
          <span>Local session · no background polling</span>
          <span>Esc closes</span>
        </footer>
      </section>
    </div>
  );
}
