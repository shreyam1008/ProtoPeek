import { ShieldCheck } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

export function ConsentPrompt({
  title,
  children,
  acknowledged,
  onAcknowledged,
  acknowledgement,
  onConfirm,
  onCancel,
  confirmLabel,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  acknowledged: boolean;
  onAcknowledged: (value: boolean) => void;
  acknowledgement: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
  disabled?: boolean;
}) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => checkboxRef.current?.focus(), []);

  return (
    <section className="this-pc-consent" role="dialog" aria-modal="false" aria-label={title}>
      <header>
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>{title}</strong>
          <span>Nothing starts until you confirm.</span>
        </div>
      </header>
      <div className="this-pc-consent-copy">{children}</div>
      <label>
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledged(event.target.checked)}
        />
        <span>{acknowledgement}</span>
      </label>
      <footer>
        <button type="button" className="this-pc-button is-quiet" onClick={onCancel}>
          Not now
        </button>
        <button
          type="button"
          className="this-pc-button"
          disabled={!acknowledged || disabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </footer>
    </section>
  );
}
