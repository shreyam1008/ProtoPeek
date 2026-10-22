import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTargetProfile } from '@/shared/types';
import { newTargetDraft } from '../workspace/model';
import { TargetForm } from './TargetForm';

function setup(overrides: Partial<Parameters<typeof TargetForm>[0]> = {}) {
  const onSaveAndConnect = vi.fn();
  const onCancelConnect = vi.fn();
  const onChange = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState<WorkspaceTargetProfile>(overrides.draft ?? newTargetDraft());
    return (
      <TargetForm
        browserProtoFolder={null}
        browserProtoFolderBusy={false}
        busy={false}
        onBrowserProtoFolderChange={vi.fn()}
        onBrowserProtoFolderBusyChange={vi.fn()}
        onSaveAndConnect={onSaveAndConnect}
        onCancelConnect={onCancelConnect}
        {...overrides}
        draft={draft}
        onChange={(next) => {
          onChange(next);
          setDraft((current) => ({ ...current, ...next }));
        }}
      />
    );
  }
  render(<Harness />);
  return { onSaveAndConnect, onCancelConnect, onChange };
}

describe('gRPC target connection form', () => {
  it('submits a valid target and gives an empty address an inline, focusable error', async () => {
    const { onSaveAndConnect } = setup();
    const form = screen.getByRole('form', { name: 'gRPC target connection' });
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveAttribute('type', 'submit');
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: ' ' } });
    fireEvent.submit(form);
    expect(onSaveAndConnect).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Address')).toHaveAccessibleDescription(
      'Enter the service address.'
    );
    await waitFor(() => expect(screen.getByLabelText('Address')).toHaveFocus());
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'localhost:50051' } });
    fireEvent.submit(form);
    expect(onSaveAndConnect).toHaveBeenCalledOnce();
  });

  it('shows required proto and import paths without expanding advanced options and preserves newlines', () => {
    const { onSaveAndConnect, onChange } = setup({
      draft: { ...newTargetDraft(), schemaSource: 'proto-files' },
    });
    const proto = screen.getByLabelText('Proto files');
    expect(proto).toBeVisible();
    expect(screen.getByLabelText('Import paths')).toBeVisible();
    expect(proto.closest('details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onSaveAndConnect).not.toHaveBeenCalled();
    expect(proto).toHaveAttribute('aria-invalid', 'true');
    expect(proto).toHaveAccessibleDescription(
      expect.stringContaining('Add at least one proto file path.')
    );
    const newline = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fireEvent(proto, newline);
    expect(newline.defaultPrevented).toBe(false);
    fireEvent.change(proto, { target: { value: 'api/one.proto\n' } });
    expect(proto).toHaveValue('api/one.proto\n');
    fireEvent.change(proto, { target: { value: 'api/one.proto\napi/two.proto' } });
    expect(onChange).toHaveBeenLastCalledWith({ protoFiles: ['api/one.proto', 'api/two.proto'] });
    fireEvent.submit(screen.getByRole('form'));
    expect(onSaveAndConnect).toHaveBeenCalledOnce();
  });

  it('requires a protoset path while keeping the selected source field visible', () => {
    const { onSaveAndConnect } = setup({
      draft: { ...newTargetDraft(), schemaSource: 'protoset' },
    });
    const paths = screen.getByLabelText('Protoset files');
    expect(paths).toBeVisible();
    expect(paths.closest('details')).toBeNull();
    fireEvent.submit(screen.getByRole('form'));
    expect(onSaveAndConnect).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one protoset file path.');
    fireEvent.change(paths, { target: { value: 'dist/service.protoset' } });
    fireEvent.submit(screen.getByRole('form'));
    expect(onSaveAndConnect).toHaveBeenCalledOnce();
  });

  it('ignores implicit submits while busy and keeps cancellation a separate button', () => {
    const { onSaveAndConnect, onCancelConnect } = setup({ busy: true });
    fireEvent.submit(screen.getByRole('form'));
    expect(onSaveAndConnect).not.toHaveBeenCalled();
    expect(onCancelConnect).not.toHaveBeenCalled();
    const cancel = screen.getByRole('button', { name: 'Cancel connection' });
    expect(cancel).toHaveAttribute('type', 'button');
    fireEvent.click(cancel);
    expect(onCancelConnect).toHaveBeenCalledOnce();
  });

  it('keeps folder picking outside submit behavior and blocks connection without a folder', () => {
    const { onSaveAndConnect } = setup({
      draft: { ...newTargetDraft(), schemaSource: 'browser-proto-folder' },
    });
    expect(screen.getByRole('button', { name: 'Choose proto folder' })).toHaveAttribute(
      'type',
      'button'
    );
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form'));
    expect(onSaveAndConnect).not.toHaveBeenCalled();
  });
});
