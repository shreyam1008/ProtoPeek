/** Run shortcuts belong to the focused request controls, never to another tool or dialog. */
export function shouldHandleWorkbenchShortcut(event: KeyboardEvent, root: HTMLElement | null) {
  if (
    event.key !== 'Enter' ||
    event.ctrlKey === event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.repeat ||
    event.isComposing ||
    event.defaultPrevented ||
    !root ||
    !(event.target instanceof Node) ||
    !root.contains(event.target)
  ) {
    return false;
  }

  if (
    event.target instanceof Element &&
    event.target.closest('[role="dialog"], dialog, [data-pp-shortcut-scope]')
  ) {
    return false;
  }

  // A modal can open before focus reaches it. Don't let that frame invoke a background request.
  return !Array.from(document.querySelectorAll('[aria-modal="true"], dialog[open]')).some(
    (dialog) => !dialog.closest('[hidden], [aria-hidden="true"]')
  );
}
