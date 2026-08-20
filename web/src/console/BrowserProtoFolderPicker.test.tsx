import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserProtoFolderSelection, ProtoDirectoryHandle } from '@/shared/proto-folder';

import { BrowserProtoFolderPicker } from './BrowserProtoFolderPicker';

function protoFile(name: string, contents: string, relativePath = '') {
  const file = new File([contents], name, { type: 'text/plain' });
  if (relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  }
  return file;
}

function directory(name: string, entries: Array<Record<string, unknown>>): ProtoDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const entry of entries) yield entry as never;
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'showDirectoryPicker');
});

describe('BrowserProtoFolderPicker', () => {
  it('uses the native folder picker and exposes a compact manifest preview with replace and clear', async () => {
    const alpha = protoFile('alpha.proto', 'alpha');
    const zeta = protoFile('zeta.proto', 'zeta');
    const handle = directory('checkout', [
      { kind: 'file', name: 'zeta.proto', getFile: async () => zeta },
      directory('nested', [{ kind: 'file', name: 'alpha.proto', getFile: async () => alpha }]),
    ]);
    const showDirectoryPicker = vi.fn(async () => handle);
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: showDirectoryPicker,
    });
    const onChange = vi.fn<(selection: BrowserProtoFolderSelection | null) => void>();
    const view = render(
      <BrowserProtoFolderPicker selection={null} onChange={onChange} disabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose proto folder' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const selection = onChange.mock.calls[0][0];
    expect(showDirectoryPicker).toHaveBeenCalledWith({ id: 'protopeek-protos', mode: 'read' });
    expect(selection?.files.map((entry) => entry.file)).toEqual([alpha, zeta]);

    view.rerender(
      <BrowserProtoFolderPicker selection={selection} onChange={onChange} disabled={false} />
    );
    const manifest = screen.getByRole('region', { name: 'Selected proto folder' });
    expect(within(manifest).getByText('checkout')).toBeVisible();
    expect(within(manifest).getByText('2 proto files · 9 B')).toBeVisible();
    expect(within(manifest).getByText('nested/alpha.proto')).toBeVisible();
    expect(within(manifest).getByText('zeta.proto')).toBeVisible();
    expect(within(manifest).getByRole('button', { name: 'Replace proto folder' })).toBeEnabled();

    fireEvent.click(within(manifest).getByRole('button', { name: 'Clear proto folder' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('falls back to webkitdirectory and keeps folder paths relative to the selected root', async () => {
    const onChange = vi.fn<(selection: BrowserProtoFolderSelection | null) => void>();
    const { container } = render(
      <BrowserProtoFolderPicker selection={null} onChange={onChange} disabled={false} />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"][webkitdirectory]');
    expect(input).not.toBeNull();
    const click = vi.spyOn(input as HTMLInputElement, 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Choose proto folder' }));
    expect(click).toHaveBeenCalledOnce();

    const nested = protoFile('echo.proto', 'rpc', 'checkout/v1/echo.proto');
    Object.defineProperty(input, 'files', { configurable: true, value: [nested] });
    fireEvent.change(input as HTMLInputElement);

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]?.rootName).toBe('checkout');
    expect(onChange.mock.calls[0][0]?.files[0].path).toBe('v1/echo.proto');
  });

  it('keeps the prior manifest and announces an invalid replacement', async () => {
    const valid = protoFile('valid.proto', 'ok', 'checkout/valid.proto');
    const selection: BrowserProtoFolderSelection = {
      rootName: 'checkout',
      files: [{ path: 'valid.proto', file: valid }],
      totalBytes: valid.size,
      ignoredFileCount: 0,
    };
    const invalid = protoFile('INVALID.PROTO', 'bad', 'other/INVALID.PROTO');
    const onChange = vi.fn();
    const { container } = render(
      <BrowserProtoFolderPicker selection={selection} onChange={onChange} disabled={false} />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [invalid] });

    fireEvent.change(input as HTMLInputElement);

    expect(await screen.findByRole('alert')).toHaveTextContent('No lowercase .proto files');
    expect(screen.getByText('checkout')).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('aborts a cleared replacement so folder A cannot overwrite newer folder B', async () => {
    let resolveA: ((file: File) => void) | undefined;
    const fileA = new Promise<File>((resolve) => {
      resolveA = resolve;
    });
    const getA = vi.fn(() => fileA);
    const a = directory('folder-a', [{ kind: 'file', name: 'a.proto', getFile: getA }]);
    const bFile = protoFile('b.proto', 'b');
    const b = directory('folder-b', [
      { kind: 'file', name: 'b.proto', getFile: async () => bFile },
    ]);
    const showDirectoryPicker = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: showDirectoryPicker,
    });
    const prior = protoFile('prior.proto', 'prior');
    const current: BrowserProtoFolderSelection = {
      rootName: 'prior-folder',
      files: [{ path: 'prior.proto', file: prior }],
      totalBytes: prior.size,
      ignoredFileCount: 0,
    };
    const onChange = vi.fn();
    const onBusyChange = vi.fn();
    const view = render(
      <BrowserProtoFolderPicker
        selection={current}
        onChange={onChange}
        onBusyChange={onBusyChange}
        disabled={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Replace proto folder' }));
    await waitFor(() => expect(getA).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Replace proto folder' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear proto folder' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear proto folder' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    view.rerender(
      <BrowserProtoFolderPicker
        selection={null}
        onChange={onChange}
        onBusyChange={onBusyChange}
        disabled={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose proto folder' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange.mock.calls[1][0].rootName).toBe('folder-b');
    resolveA?.(protoFile('a.proto', 'a'));
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onBusyChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });

  it('invalidates a replacement when the parent disables the picker for a connection change', async () => {
    const prior = protoFile('prior.proto', 'prior');
    const current: BrowserProtoFolderSelection = {
      rootName: 'prior-folder',
      files: [{ path: 'prior.proto', file: prior }],
      totalBytes: prior.size,
      ignoredFileCount: 0,
    };
    let resolveReplacement: ((file: File) => void) | undefined;
    const replacement = new Promise<File>((resolve) => {
      resolveReplacement = resolve;
    });
    const getFile = vi.fn(() => replacement);
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () =>
        directory('replacement', [{ kind: 'file', name: 'replacement.proto', getFile }])
      ),
    });
    const onChange = vi.fn();
    const onBusyChange = vi.fn();
    const view = render(
      <BrowserProtoFolderPicker
        selection={current}
        onChange={onChange}
        onBusyChange={onBusyChange}
        disabled={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace proto folder' }));
    await waitFor(() => expect(getFile).toHaveBeenCalledOnce());

    view.rerender(
      <BrowserProtoFolderPicker
        selection={current}
        onChange={onChange}
        onBusyChange={onBusyChange}
        disabled
      />
    );
    resolveReplacement?.(protoFile('replacement.proto', 'replacement'));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('prior-folder')).toBeVisible();
  });
});
