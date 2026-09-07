import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HTTPRequestLibrary } from './HTTPRequestLibrary';
import { emptyHTTPDraft } from './http-draft-store';
import { readHTTPLibrary, saveHTTPRecipe } from './http-library';

afterEach(() => localStorage.clear());
it('saves, loads without sending, updates and removes a recipe', () => {
  const onLoad = vi.fn();
  let draft = { ...emptyHTTPDraft(), bodyMode: 'json' as const, body: '{"name":"fixture"}' };
  render(<HTTPRequestLibrary getDraft={() => draft} onLoad={onLoad} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Fixture' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new' }));
  expect(readHTTPLibrary().requests[0].draft.body).toBe('');
  expect(onLoad).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Load Fixture' }));
  expect(onLoad).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByLabelText('Include this request body'));
  draft = { ...draft, method: 'POST' };
  fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Fixture POST' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update selected' }));
  expect(readHTTPLibrary().requests[0]).toMatchObject({
    name: 'Fixture POST',
    draft: { method: 'POST', body: '{"name":"fixture"}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Delete Fixture POST' }));
  expect(readHTTPLibrary().requests).toEqual([]);
});

it('filters saved entries and lets the user cancel clearing the library', () => {
  saveHTTPRecipe('Health', emptyHTTPDraft());
  saveHTTPRecipe('Echo', emptyHTTPDraft());
  render(<HTTPRequestLibrary getDraft={emptyHTTPDraft} onLoad={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Find saved requests'), { target: { value: 'health' } });
  expect(screen.getByRole('button', { name: 'Load Health' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Load Echo' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset library' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep requests' }));
  expect(readHTTPLibrary().requests).toHaveLength(2);
});
