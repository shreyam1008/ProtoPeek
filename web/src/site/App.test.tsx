import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('public site', () => {
  it('keeps the mobile navigation small and keyboard dismissible', () => {
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Open site navigation' });
    const mobileNavigation = document.getElementById('mobile-site-navigation');
    expect(mobileNavigation).not.toBeNull();
    if (!mobileNavigation) throw new Error('Mobile navigation did not render.');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(mobileNavigation).toHaveAttribute('hidden');

    fireEvent.click(toggle);
    expect(within(mobileNavigation).getByRole('link', { name: 'Guides' })).toHaveAttribute(
      'href',
      '/docs/'
    );
    expect(within(mobileNavigation).getByRole('link', { name: 'GitHub' })).toBeVisible();

    fireEvent.keyDown(screen.getByRole('navigation', { name: 'Primary' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open site navigation' })).toHaveFocus();
    expect(mobileNavigation).toHaveAttribute('hidden');
  });

  it('leads with a plain promise and question-led tasks', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Find, reach, and inspect services locally.' })
    ).toBeVisible();
    expect(screen.getByText('Local-first. No account.')).toBeVisible();

    const product = screen.getByRole('region', { name: 'Start with a question.' });
    expect(
      within(product)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual([
      'Can I reach this service?',
      'Why is this request slow?',
      'What can I verify about this public website?',
      'What is happening on this computer?',
      'Can I manage this download locally?',
    ]);
    expect(within(product).getByRole('link', { name: /meet downloader/i })).toHaveAttribute(
      'href',
      '/downloader/'
    );
    expect(within(product).getByRole('link', { name: /preview this pc/i })).toHaveAttribute(
      'href',
      '/this-pc/'
    );
    expect(within(product).getByText(/current-source preview/i)).toBeVisible();
    expect(within(product).getByRole('link', { name: /choose grpc or http/i })).toHaveAttribute(
      'href',
      '/docs/#protocols'
    );
    expect(within(product).getByRole('link', { name: /trace the path/i })).toHaveAttribute(
      'href',
      '/network-workbench/#network-path'
    );
    expect(within(product).getByRole('link', { name: /see website evidence/i })).toHaveAttribute(
      'href',
      '/security/'
    );
    expect(within(product).getByRole('link', { name: /explore all features/i })).toHaveAttribute(
      'href',
      '/docs/'
    );
  });

  it('uses only repository-verified screenshots and labels older captures honestly', () => {
    render(<App />);

    const evidence = screen.getByRole('region', { name: 'One workbench. Real evidence.' });
    expect(
      within(evidence)
        .getAllByRole('img')
        .map((image) => image.getAttribute('src'))
    ).toEqual([
      '/assets/protopeek-downloader-development-mobile.jpg',
      '/assets/protopeek-dashboard-dark.png',
    ]);
    expect(within(evidence).getByText(/v0\.3\.0 capture/i)).toBeVisible();
    expect(within(evidence).getByText('Downloader · v0.5.0 mobile')).toBeVisible();
  });

  it('shows one concise install command and switches it by operating system', () => {
    render(<App />);

    const install = screen.getByRole('region', { name: 'Ready when you are.' });
    expect(within(install).getByRole('button', { name: 'macOS' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(install).getByRole('textbox', { name: 'macOS install command' })).toHaveValue(
      'brew install shreyam1008/tap/protopeek'
    );
    expect(within(install).getAllByRole('textbox')).toHaveLength(1);

    fireEvent.click(within(install).getByRole('button', { name: 'Windows' }));
    expect(within(install).getByRole('textbox', { name: 'Windows install command' })).toHaveValue(
      'irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex'
    );
    expect(within(install).getByRole('link', { name: /other install options/i })).toHaveAttribute(
      'href',
      '/install/'
    );
  });

  it('reports copy success only after the active command is written', async () => {
    let resolveWrite: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy macOS command' }));
    expect(screen.queryByRole('button', { name: 'macOS command copied' })).not.toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('brew install shreyam1008/tap/protopeek');

    resolveWrite?.();
    expect(await screen.findByRole('button', { name: 'macOS command copied' })).toBeVisible();
  });

  it('selects the command for manual copy and states the privacy boundary', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Linux' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Linux command' }));
    expect(await screen.findByText(/clipboard unavailable/i)).toBeVisible();

    const command = screen.getByRole('textbox', { name: 'Linux install command' });
    await waitFor(() => expect(command).toHaveFocus());
    expect(command).toHaveProperty('selectionStart', 0);
    expect(command).toHaveProperty('selectionEnd', command.getAttribute('value')?.length);

    const privacy = screen.getByRole('region', { name: 'Your machine stays yours.' });
    expect(within(privacy).getByText(/external checks run only when you ask/i)).toBeVisible();
    expect(within(privacy).getByText('No ProtoPeek cloud sync')).toBeVisible();
  });
});
