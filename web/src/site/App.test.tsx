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
    expect(
      screen.getByText(
        'go install github.com/shreyam1008/ProtoPeek/cmd/protopeek@latest github.com/shreyam1008/ProtoPeek/cmd/pp@latest'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/owned Homebrew\/Scoop channels resolve v0\.4\.0/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/v0\.4\.0 stable/i)).toBeInTheDocument();
    expect(screen.getAllByText('Shipped · v0.4.0').length).toBeGreaterThan(0);
    expect(screen.getByText(/WinGet only after initial package feedback/)).toBeInTheDocument();
  });

  it('keeps cURL export in the shipped phase and only import in Next', () => {
    render(<App />);

    const shipped = screen
      .getByRole('heading', { name: 'Protocol workbenches + bounded evidence' })
      .closest<HTMLElement>('.pp-panel');
    const next = screen
      .getByRole('heading', { name: 'Close daily workflow gaps' })
      .closest<HTMLElement>('.pp-panel');
    expect(shipped).not.toBeNull();
    expect(next).not.toBeNull();
    if (!shipped || !next) return;

    expect(within(shipped).getByText(/bounded cURL export/i)).toBeVisible();
    expect(within(next).getByText(/bounded cURL import/i)).toBeVisible();
    expect(within(next).queryByText(/cURL import\/export/i)).not.toBeInTheDocument();
  });
});
