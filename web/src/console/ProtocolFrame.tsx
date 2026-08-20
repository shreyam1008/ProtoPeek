import { Link, Outlet } from '@tanstack/react-router';
import { Server, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function ProtocolFrame() {
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  return (
    <div className="pp-protocol-frame">
      <nav className="pp-protocol-rail" aria-label="Request protocols">
        <div className="pp-protocol-mark" aria-hidden="true">
          P
        </div>
        <span className="pp-rail-label">Requests</span>
        <Link
          to="/"
          activeOptions={{ exact: true }}
          activeProps={{ className: 'is-active' }}
          aria-label="Open the gRPC workbench"
        >
          <Server aria-hidden="true" />
          <span>gRPC</span>
        </Link>
        <Link
          to="/http"
          activeProps={{ className: 'is-active' }}
          aria-label="Open the HTTP workbench"
        >
          <i className="pp-protocol-glyph" aria-hidden="true">
            H
          </i>
          <span>HTTP</span>
        </Link>
        <button
          type="button"
          className="pp-rail-help"
          aria-label="Open ProtoPeek help"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen(true)}
        >
          <i aria-hidden="true">?</i>
          <span>Help</span>
        </button>
      </nav>
      <main className="pp-protocol-surface">
        <Outlet />
      </main>
      <HelpDrawer open={helpOpen} onClose={closeHelp} />
    </div>
  );
}

function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="pp-help-layer">
      <button
        type="button"
        className="pp-help-backdrop"
        aria-label="Close help"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className="pp-help-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="protopeek-help-title"
      >
        <header>
          <div>
            <span>Protocol checklist</span>
            <h2 id="protopeek-help-title">Debug what is actually on the wire.</h2>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Close help" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <section>
          <h3>gRPC</h3>
          <ul>
            <li>Confirm plaintext versus verified TLS before invoking.</li>
            <li>Use reflection, proto files, or protosets for the schema.</li>
            <li>Inspect response headers, messages, trailers, and final status separately.</li>
          </ul>
        </section>
        <section>
          <h3>HTTP / REST</h3>
          <ul>
            <li>Redirects are off and certificate verification is on by default.</li>
            <li>
              Check the negotiated protocol, remote peer, timing phases, and truncation marker.
            </li>
            <li>Auth values stay in the live editor and are redacted from local history.</li>
          </ul>
        </section>
        <section className="pp-help-planned">
          <h3>Planned, not clickable</h3>
          <p>Cap&apos;n Proto, route trace, and LAN discovery remain gated roadmap work.</p>
        </section>
      </aside>
    </div>
  );
}
