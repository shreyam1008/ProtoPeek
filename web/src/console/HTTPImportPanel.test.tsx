import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HTTPImportPanel } from './HTTPImportPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('previews browser compression differences and live-only cookies before loading an unsent request', () => {
  const request = vi.spyOn(globalThis, 'fetch');
  const onLoad = vi.fn();
  render(<HTTPImportPanel onLoad={onLoad} onClose={vi.fn()} />);
  expect(screen.getByText(/Copy as cURL \(bash\/POSIX\)/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('cURL command'), {
    target: {
      value:
        'curl https://example.test -b \'session=sentinel-cookie\' --compressed --data-raw \'{"user":{"id":1}}\'',
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview request' }));
  expect(screen.getByText(/relay negotiates and decodes gzip/)).toBeVisible();
  expect(screen.getByText(/1 credential fields stay/)).toBeVisible();
  expect(screen.getByRole('group', { name: 'cURL request preview' })).not.toHaveTextContent(
    'sentinel-cookie'
  );
  expect(onLoad).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Load into editor' }));
  expect(onLoad).toHaveBeenCalledOnce();
  expect(onLoad.mock.calls[0][0].draft.headers).toContainEqual({
    name: 'Cookie',
    value: 'session=sentinel-cookie',
  });
  expect(request).not.toHaveBeenCalled();
});
