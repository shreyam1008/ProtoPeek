import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Roadmap } from './Roadmap';

describe('Roadmap', () => {
  it('filters by capability and status without losing the search', () => {
    render(<Roadmap />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search roadmap' }), {
      target: { value: 'cURL' },
    });
    expect(screen.getByRole('heading', { name: 'HTTP workbench' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    expect(screen.queryByRole('heading', { name: 'HTTP workbench' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No matching capabilities' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Available/ }));
    expect(screen.getByRole('heading', { name: 'HTTP workbench' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Gated/ }));
    expect(screen.getByRole('heading', { name: 'No matching capabilities' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Search roadmap' })).toHaveValue('cURL');
  });
  it('lists reviewed cURL import and export in this build while keeping native acceptance explicit', () => {
    render(<Roadmap />);

    const available = screen
      .getByRole('heading', { name: 'Available in this build' })
      .closest('section');
    const next = screen.getByRole('heading', { name: 'Next' }).closest('section');
    expect(available).not.toBeNull();
    expect(next).not.toBeNull();
    if (!available || !next) return;

    expect(within(available).getByRole('heading', { name: 'Workbench + themes' })).toBeVisible();
    expect(within(available).queryByText('Dashboard + themes')).not.toBeInTheDocument();
    expect(within(available).getByText(/bounded.*credential-redacted cURL export/i)).toBeVisible();
    expect(within(available).getByText(/reviewed shell-free cURL import subset/i)).toBeVisible();
    expect(
      within(next).getByRole('heading', { name: 'Native installed-tool acceptance' })
    ).toBeVisible();
    expect(within(next).queryByRole('heading', { name: 'cURL import' })).not.toBeInTheDocument();
  });

  it('shows the bounded network workbench as available and keeps wider scanning gated', () => {
    render(<Roadmap />);

    const available = screen
      .getByRole('heading', { name: 'Available in this build' })
      .closest('section');
    const gated = screen.getByRole('heading', { name: 'Gated' }).closest('section');
    expect(available).not.toBeNull();
    expect(gated).not.toBeNull();
    if (!available || !gated) return;

    expect(
      within(available).getByRole('heading', { name: 'Network Path · native platforms' })
    ).toBeVisible();
    expect(
      within(available).getByRole('heading', { name: 'Authorized private discovery' })
    ).toBeVisible();
    expect(within(available).getByRole('heading', { name: 'Network map + history' })).toBeVisible();
    expect(
      within(gated).getByRole('heading', { name: 'Broader/public range discovery' })
    ).toBeVisible();
    expect(within(gated).queryByText('Traceroute / hop probes')).not.toBeInTheDocument();
  });

  it('separates bounded canonical operations and owned publishing from administrator/account changes', () => {
    render(<Roadmap />);

    const available = screen
      .getByRole('heading', { name: 'Available in this build' })
      .closest('section');
    const next = screen.getByRole('heading', { name: 'Next' }).closest('section');
    const gated = screen.getByRole('heading', { name: 'Gated' }).closest('section');
    expect(available).not.toBeNull();
    expect(next).not.toBeNull();
    expect(gated).not.toBeNull();
    if (!available || !next || !gated) return;

    expect(
      within(available).getByRole('heading', { name: 'Cloudflare canonical operations' })
    ).toBeVisible();
    expect(
      within(available).getByRole('heading', { name: 'Temporary publishing sessions' })
    ).toBeVisible();
    expect(
      within(gated).getByRole('heading', { name: 'Administrator config + credentials' })
    ).toBeVisible();
    expect(
      within(next).getByRole('heading', { name: 'Release and provider acceptance' })
    ).toBeVisible();
  });
});
