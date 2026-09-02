import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette, type PaletteAction } from './CommandPalette';

afterEach(() => {
  vi.unstubAllGlobals();
});

function PaletteHarness({ actions }: { actions: PaletteAction[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open commands
      </button>
      <CommandPalette open={open} actions={actions} onClose={() => setOpen(false)} />
    </>
  );
}

describe('CommandPalette', () => {
  it('moves the active result with arrows and runs that result with Enter', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const runs = [vi.fn(), vi.fn(), vi.fn()];
    render(
      <PaletteHarness
        actions={[
          { id: 'first', label: 'First action', run: runs[0] },
          { id: 'second', label: 'Second action', run: runs[1] },
          { id: 'third', label: 'Third action', run: runs[2] },
        ]}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Open commands' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'ProtoPeek commands' });
    const input = within(dialog).getByRole('combobox', { name: 'Search commands' });
    const listbox = within(dialog).getByRole('listbox', { name: 'Commands' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    const first = within(listbox).getByRole('option', { name: 'First action' });
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(within(listbox).getByRole('option', { name: 'Third action' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(listbox).getByRole('option', { name: 'Second action' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(runs[1]).toHaveBeenCalledOnce();
    expect(runs[0]).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek commands' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('announces an empty result, resets its query, and closes outside or with Escape', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const run = vi.fn();
    const { container } = render(
      <PaletteHarness
        actions={[{ id: 'inspect', label: 'Inspect target', keywords: 'service', run }]}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Open commands' });

    trigger.focus();
    fireEvent.click(trigger);
    let input = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(input, { target: { value: 'missing' } });
    expect(screen.getByRole('status')).toHaveTextContent('No matching command.');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('.pp-command-dismiss') as HTMLButtonElement);
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek commands' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    input = screen.getByRole('combobox', { name: 'Search commands' });
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek commands' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
