import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('public site navigation', () => {
  it('keeps narrow navigation collapsed until requested and closes after navigation', () => {
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Open site navigation' });
    const mobileNavigation = document.getElementById('mobile-site-navigation');
    expect(mobileNavigation).not.toBeNull();
    if (!mobileNavigation) throw new Error('Mobile navigation did not render.');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(mobileNavigation).toHaveAttribute('hidden');

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Close site navigation' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(mobileNavigation).not.toHaveAttribute('hidden');
    expect(within(mobileNavigation).getByRole('link', { name: 'Features' })).toBeVisible();

    fireEvent.click(within(mobileNavigation).getByRole('link', { name: 'Features' }));
    expect(mobileNavigation).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Open site navigation' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('lets keyboard users dismiss the narrow navigation', () => {
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Open site navigation' });
    fireEvent.click(toggle);
    fireEvent.keyDown(screen.getByRole('navigation', { name: 'Primary' }), { key: 'Escape' });

    expect(screen.getByRole('button', { name: 'Open site navigation' })).toHaveFocus();
    expect(document.getElementById('mobile-site-navigation')).toHaveAttribute('hidden');
  });

  it('publishes owned package installs and keeps WinGet in the feedback-gated roadmap', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Copy Homebrew command' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Scoop command' })).toBeInTheDocument();
    expect(screen.getByText(/WinGet only after initial package feedback/)).toBeInTheDocument();
  });
});
