import { type RefObject, useEffect, useEffectEvent, useRef } from 'react';

export function useDialogFocus<
  DialogElement extends HTMLElement,
  InitialElement extends HTMLElement,
>(
  open: boolean,
  onClose: () => void,
  dialogRef: RefObject<DialogElement | null>,
  initialFocusRef: RefObject<InitialElement | null>
) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closeDialog = useEffectEvent(onClose);

  // Ref contents are intentionally read when the dialog opens or handles a key; the ref objects
  // themselves are stable and changes to `.current` must not reinstall the window listener.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see the ref-lifetime note above
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => initialFocusRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
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
}
