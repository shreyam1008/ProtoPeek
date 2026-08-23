import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('public site', () => {
  it('keeps narrow navigation collapsed, closes after navigation, and restores focus on Escape', () => {
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
    expect(within(mobileNavigation).getByRole('link', { name: 'Development build' })).toBeVisible();

    fireEvent.click(within(mobileNavigation).getByRole('link', { name: 'Development build' }));
    expect(mobileNavigation).toHaveAttribute('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Open site navigation' }));
    fireEvent.keyDown(screen.getByRole('navigation', { name: 'Primary' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open site navigation' })).toHaveFocus();
    expect(mobileNavigation).toHaveAttribute('hidden');
  });

  it('presents exactly the six unified development areas', () => {
    render(<App />);

    const suite = screen.getByRole('region', { name: 'Six areas. One explicit local shell.' });
    expect(
      within(suite)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual(['Overview', 'Protocols', 'Network', 'Downloader', 'Security', 'Settings']);
    expect(
      within(suite).getByText(/current development source, not the published v0\.4\.0/i)
    ).toBeVisible();
  });

  it('uses only repository-verified, version-labelled real screenshots', () => {
    render(<App />);

    const gallery = screen.getByRole('region', { name: 'Verified product captures.' });
    const images = within(gallery).getAllByRole('img');
    expect(images).toHaveLength(5);
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      '/assets/protopeek-downloader-development.jpg',
      '/assets/protopeek-downloader-development-mobile.jpg',
      '/assets/protopeek-dashboard-dark.png',
      '/assets/protopeek-dashboard.png',
      '/assets/protopeek-dashboard-mobile.png',
    ]);
    const captions = Array.from(gallery.querySelectorAll('figcaption')).map(
      (caption) => caption.textContent ?? ''
    );
    expect(captions).toHaveLength(5);
    expect(
      captions.every((caption) => /Real (?:local )?(?:headless )?Chrome capture/i.test(caption))
    ).toBe(true);
    expect(captions.filter((caption) => /current unreleased source/i.test(caption))).toHaveLength(
      2
    );
    expect(
      captions
        .filter((caption) => /current unreleased source/i.test(caption))
        .every((caption) => /not stable v0\.4\.0/i.test(caption))
    ).toBe(true);
    expect(captions.filter((caption) => /v0\.3\.0/.test(caption))).toHaveLength(3);
    expect(
      within(gallery).getByText(/Downloader pair shows current unreleased source/i)
    ).toBeVisible();
  });

  it('separates development-only Downloader and Security behavior from stable v0.4.0', () => {
    render(<App />);

    const development = screen.getByRole('region', {
      name: 'What is available in the current source build.',
    });
    expect(within(development).getByText(/not part of stable v0\.4\.0/i)).toBeVisible();
    expect(within(development).getByText(/configured or system-installed/i)).toBeVisible();
    expect(within(development).getByText(/does not bundle aria2/i)).toBeVisible();
    expect(
      within(development).getByText('pp download [--output NAME] [--sha256 64_HEX] URL')
    ).toBeVisible();
    expect(development).toHaveTextContent(/sent to crt\.name/i);
    expect(within(development).getByText(/exactly one credential-free/i)).toBeVisible();
    expect(within(development).getByText(/no security score/i)).toBeVisible();
  });

  it('keeps stable package channels and version separate from current source', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Install stable v0.4.0.' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy Homebrew command' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Scoop command' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Unix command' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy PowerShell command' })).toBeInTheDocument();
    expect(
      screen.getByText(/unified development additions.*require the current source/i)
    ).toBeVisible();
  });

  it('reports copy success only after the clipboard write resolves', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Copy Homebrew command' }));
    expect(
      screen.queryByRole('button', { name: 'Homebrew command copied' })
    ).not.toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('brew install shreyam1008/tap/protopeek');

    resolveWrite?.();
    expect(await screen.findByRole('button', { name: 'Homebrew command copied' })).toBeVisible();
  });

  it('selects the command and explains manual copy when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Scoop command' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/clipboard unavailable/i);

    const command = screen.getByRole('textbox', { name: 'Scoop install command' });
    await waitFor(() => expect(command).toHaveFocus());
    expect(command).toHaveProperty('selectionStart', 0);
    expect(command).toHaveProperty('selectionEnd', command.getAttribute('value')?.length);
  });
});
