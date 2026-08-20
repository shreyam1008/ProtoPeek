import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Roadmap } from './Roadmap';

describe('Roadmap', () => {
  it('lists bounded cURL export as shipped and only cURL import as Next', () => {
    render(<Roadmap />);

    const available = screen
      .getByRole('heading', { name: 'Available in this build' })
      .closest('section');
    const next = screen.getByRole('heading', { name: 'Next' }).closest('section');
    expect(available).not.toBeNull();
    expect(next).not.toBeNull();
    if (!available || !next) return;

    expect(within(available).getByText(/bounded.*credential-redacted cURL export/i)).toBeVisible();
    expect(within(next).getByRole('heading', { name: 'cURL import' })).toBeVisible();
    expect(within(next).queryByText(/cURL import\/export/i)).not.toBeInTheDocument();
  });
});
