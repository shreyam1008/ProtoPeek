import { useEffect, useRef } from 'react';
import { type TailAction, tailActions } from './tailnet-api';

export function TailnetOperationReview({
  draft,
  busy,
  consent,
  onConsent,
  onRun,
  onDismiss,
}: {
  draft: { action: TailAction; label: string; path: string };
  busy: boolean;
  consent: boolean;
  onConsent: (value: boolean) => void;
  onRun: () => void;
  onDismiss: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (draft) heading.current?.focus();
  }, [draft]);
  return (
    <section className="pp-tailnet-review" aria-label="Review Tailscale operation">
      <h2 ref={heading} tabIndex={-1}>
        {tailActions[draft.action].label}
      </h2>
      <p>{tailActions[draft.action].detail}</p>
      {draft.label ? (
        <p>
          Target: <strong>{draft.label}</strong>
        </p>
      ) : null}
      {draft.action === 'login-server' ? (
        // HeadscaleAccount supplies URL.toString(), percent-encoding non-ASCII quotes before shell-specific ASCII escaping.
        <details>
          <summary>Finish sign-in on this computer</summary>
          <p>
            The native login has a 30-second timeout. On a headless host, run the command below in a
            terminal on this computer. Use the installed Tailscale executable or its full path if it
            is not on PATH.
          </p>
          <p>
            The native terminal prints the private browser or Headscale registration link and waits
            for sign-in. Complete OIDC or ask your Headscale administrator to register it, then
            refresh ProtoPeek. Keep the link private; ProtoPeek does not receive or retain it.
          </p>
          <p>
            On Linux, login may require sudo unless your user is configured as a Tailscale operator.
            Authorization stays in your terminal.
          </p>
          <p>macOS / Linux</p>
          <pre>{`tailscale login '${`--login-server=${draft.label}`.replaceAll("'", "'\"'\"'")}'`}</pre>
          <p>Windows PowerShell</p>
          <pre>{`tailscale login '${`--login-server=${draft.label}`.replaceAll("'", "''")}'`}</pre>
        </details>
      ) : null}
      {draft.path ? (
        <p>
          Path: <code>{draft.path}</code>
        </p>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(event) => onConsent(event.target.checked)}
        />{' '}
        I authorize this operation on this computer.
      </label>
      <div className="pp-tailnet-toolbar">
        <button type="button" disabled={busy || !consent} onClick={onRun}>
          Run selected operation
        </button>
        <button type="button" disabled={busy} onClick={onDismiss}>
          Dismiss operation
        </button>
      </div>
    </section>
  );
}
