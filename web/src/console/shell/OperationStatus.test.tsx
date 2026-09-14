import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationStatus } from './OperationStatus';

afterEach(() => vi.useRealTimers());
it('uses indeterminate progress until a real total is available and cleans up its timer', () => {
  vi.useFakeTimers();
  const view = render(<OperationStatus busy label="Sending request" />);
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByText('3s elapsed')).toBeVisible();
  view.rerender(<OperationStatus busy={false} label="Sending request" />);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});
it('shows measured progress and resets elapsed time for another run', () => {
  vi.useFakeTimers();
  const view = render(<OperationStatus busy label="Scanning" completed={256} total={65535} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '256');
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '65535');
  act(() => vi.advanceTimersByTime(2000));
  view.rerender(<OperationStatus busy={false} label="Scanning" />);
  view.rerender(<OperationStatus busy label="Scanning" />);
  expect(screen.getByText('0s elapsed')).toBeVisible();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
