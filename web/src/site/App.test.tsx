import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => vi.restoreAllMocks());

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
      'What is happening on this device?',
      'Can I manage this download locally?',
      'Which optional tool does this task need?',
    ]);
    expect(within(product).getByRole('link', { name: /meet downloader/i })).toHaveAttribute(
      'href',
      '/downloader/'
    );
    expect(within(product).getByRole('link', { name: /preview this device/i })).toHaveAttribute(
      'href',
      '/this-pc/'
    );
    expect(within(product).getByText(/network workspace/i)).toBeVisible();
    expect(within(product).getByRole('link', { name: 'Explore Extensions' })).toHaveAttribute(
      'href',
      '/extensions/'
    );
    expect(within(product).getByText(/Current source: native workbenches/)).toBeVisible();
    expect(within(product).getByRole('link', { name: /make your first request/i })).toHaveAttribute(
      'href',
      '/http-workbench/'
    );
    const protocols = screen.getByRole('navigation', { name: 'Protocol guides' });
    expect(
      within(protocols)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
    ).toEqual(['/http-workbench/', '/grpc-workbench/', '/event-streams/', '/capnp-workbench/']);
    expect(screen.getByRole('link', { name: 'Install stable v0.6.1' })).toHaveAttribute(
      'href',
      '#install'
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

  it('keeps dated legacy Edge screenshots separate from stable install commands', () => {
    render(<App />);

    const evidence = screen.getByRole('region', { name: 'One workbench. Real evidence.' });
    expect(
      within(evidence)
        .getAllByRole('img')
        .map((image) => image.getAttribute('src'))
    ).toEqual([
      '/assets/protopeek-workspace-edge-mobile.png',
      '/assets/protopeek-workspace-edge-desktop.png',
    ]);
    expect(within(evidence).getByText('Legacy Edge · persistent desktop navigation')).toBeVisible();
    expect(within(evidence).getByText('Legacy Edge · responsive Home')).toBeVisible();
  });

  it('shows one concise install command and switches it by operating system', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('unknown');
    render(<App />);

    const install = screen.getByRole('region', { name: 'Ready when you are.' });
    expect(within(install).getByRole('button', { name: 'macOS / Linux' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      within(install).getByRole('textbox', { name: 'macOS / Linux install command' })
    ).toHaveValue(
      'curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh'
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

  it('prerenders a working neutral command and a Windows fallback without browser detection', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const html = renderToString(<App />);
    expect(html).toContain('aria-label="macOS / Linux install command"');
    expect(html).toContain(
      'curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh'
    );
    expect(html).toContain('<noscript>');
    expect(html).toContain('Windows PowerShell:');
    expect(html).toContain(
      'irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex'
    );
  });

  it('suggests Windows only after mount and preserves a manual platform selection', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const view = render(<App />);
    expect(screen.getByRole('textbox', { name: 'Windows install command' })).toBeVisible();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'macOS / Linux' }));
    view.rerender(<App />);
    expect(screen.getByRole('textbox', { name: 'macOS / Linux install command' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Windows' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
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

    fireEvent.click(screen.getByRole('button', { name: 'Copy macOS / Linux command' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(
      screen.queryByRole('button', { name: 'macOS / Linux command copied' })
    ).not.toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      'curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh'
    );

    resolveWrite?.();
    expect(
      await screen.findByRole('button', { name: 'macOS / Linux command copied' })
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Command copied.');
  });

  it('selects the command for manual copy and states the privacy boundary', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'macOS / Linux' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy macOS / Linux command' }));
    expect(await screen.findByText(/clipboard unavailable/i)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Clipboard unavailable.');

    const command = screen.getByRole('textbox', { name: 'macOS / Linux install command' });
    await waitFor(() => expect(command).toHaveFocus());
    expect(command).toHaveProperty('selectionStart', 0);
    expect(command).toHaveProperty('selectionEnd', command.getAttribute('value')?.length);

    const privacy = screen.getByRole('region', { name: 'Your machine stays yours.' });
    expect(within(privacy).getByText(/external checks run only when you ask/i)).toBeVisible();
    expect(within(privacy).getByText('No ProtoPeek cloud sync')).toBeVisible();
  });
});
