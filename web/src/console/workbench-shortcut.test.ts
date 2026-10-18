import { afterEach, describe, expect, it } from 'vitest';
import { shouldHandleWorkbenchShortcut } from './workbench-shortcut';

afterEach(() => {
  document.body.replaceChildren();
});

function shortcut(init: KeyboardEventInit = {}, outside = false) {
  const root = document.createElement('section');
  const editor = document.createElement('textarea');
  root.append(editor);
  document.body.append(root);
  const target = outside ? document.body : editor;
  let accepted = false;
  target.addEventListener('keydown', (event) => {
    accepted = shouldHandleWorkbenchShortcut(event as KeyboardEvent, root);
  });
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return { accepted, root, editor };
}

describe('workbench run shortcut', () => {
  it('accepts Ctrl or Command + Enter from the request editor', () => {
    expect(shortcut().accepted).toBe(true);
    expect(shortcut({ ctrlKey: false, metaKey: true }).accepted).toBe(true);
  });

  it.each([
    { repeat: true },
    { isComposing: true },
    { altKey: true },
    { shiftKey: true },
    { metaKey: true },
    { ctrlKey: false },
    { key: 'Escape' },
  ])('does not invoke for a modified or repeated event: %j', (init) => {
    expect(shortcut(init).accepted).toBe(false);
  });

  it('does not invoke from outside the request controls', () => {
    expect(shortcut({}, true).accepted).toBe(false);
  });

  it('respects a control that has already handled the key', () => {
    const { root, editor } = shortcut();
    const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true });
    event.preventDefault();
    editor.dispatchEvent(event);
    expect(shouldHandleWorkbenchShortcut(event, root)).toBe(false);
  });

  it.each(['role', 'native', 'scope'])('does not invoke from a nested %s dialog/scope', (kind) => {
    const { root, editor } = shortcut();
    const panel = document.createElement(kind === 'native' ? 'dialog' : 'div');
    if (kind === 'role') panel.setAttribute('role', 'dialog');
    if (kind === 'scope') panel.setAttribute('data-pp-shortcut-scope', 'import');
    root.append(panel);
    panel.append(editor);
    let accepted = true;
    editor.addEventListener('keydown', (event) => {
      accepted = shouldHandleWorkbenchShortcut(event, root);
    });
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    expect(accepted).toBe(false);
  });

  it('blocks the underlying editor while a modal is opening, and permits it after closing', () => {
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    expect(shortcut().accepted).toBe(false);
    modal.hidden = true;
    expect(shortcut().accepted).toBe(true);
  });
});
