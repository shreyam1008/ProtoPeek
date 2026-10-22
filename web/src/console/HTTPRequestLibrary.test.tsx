import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HTTPRequestLibrary } from './HTTPRequestLibrary';
import { emptyHTTPDraft } from './http-draft-store';
import {
  exportHTTPLibrary,
  readHTTPLibrary,
  resetHTTPLibrary,
  saveHTTPRecipe,
} from './http-library';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it('previews a file without writes or requests, then imports only after explicit confirmation', async () => {
  saveHTTPRecipe('Imported', emptyHTTPDraft());
  const raw = exportHTTPLibrary();
  resetHTTPLibrary();
  saveHTTPRecipe('Kept', emptyHTTPDraft());
  const onLoad = vi.fn();
  render(<HTTPRequestLibrary getDraft={emptyHTTPDraft} onClose={vi.fn()} onLoad={onLoad} />);
  fireEvent.change(screen.getByLabelText('Import request library'), {
    target: { files: [{ size: raw.length, text: async () => raw }] },
  });
  expect(await screen.findByRole('group', { name: 'Library import preview' })).toHaveTextContent(
    'Imported'
  );
  expect(readHTTPLibrary().requests.map((item) => item.name)).toEqual(['Kept']);
  expect(onLoad).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Import library' }));
  expect(readHTTPLibrary().requests).toHaveLength(2);
  expect(onLoad).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Load Imported' }));
  expect(onLoad).toHaveBeenCalledOnce();
});

it('discards a stale asynchronous file read after another tab changes the library', async () => {
  saveHTTPRecipe('Kept', emptyHTTPDraft());
  const raw = exportHTTPLibrary();
  let complete!: (value: string) => void;
  const text = new Promise<string>((resolve) => {
    complete = resolve;
  });
  render(<HTTPRequestLibrary getDraft={emptyHTTPDraft} onClose={vi.fn()} onLoad={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Import request library'), {
    target: { files: [{ size: 100, text: () => text }] },
  });
  fireEvent(window, new StorageEvent('storage', { key: 'protopeek.httpLibrary.v1' }));
  complete(raw);
  await waitFor(() => expect(screen.queryByText('Reading library…')).not.toBeInTheDocument());
  expect(screen.queryByRole('group', { name: 'Library import preview' })).not.toBeInTheDocument();
  expect(readHTTPLibrary().requests).toHaveLength(1);
});
