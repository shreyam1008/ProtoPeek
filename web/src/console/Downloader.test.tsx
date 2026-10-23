import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Downloader } from './Downloader';

vi.mock('./FileDownloader', () => ({ default: () => <h1>File transfer queue</h1> }));
vi.mock('./MediaDownloader', () => ({ default: () => <h1>Media download queue</h1> }));

afterEach(() => vi.restoreAllMocks());

describe('Download workspace', () => {
  it('opens files first and loads the selected independent view', async () => {
    render(<Downloader />);
    await screen.findByRole('heading', { name: 'File transfer queue' });
    expect(screen.queryByRole('heading', { name: 'Media download queue' })).not.toBeInTheDocument();
    const files = screen.getByRole('button', { name: 'Files', pressed: true });
    fireEvent.click(screen.getByRole('button', { name: 'Media, galleries & webpages' }));
    await screen.findByRole('heading', { name: 'Media download queue' });
    expect(files).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('heading', { name: 'File transfer queue' })).not.toBeInTheDocument();
    fireEvent.click(files);
    await screen.findByRole('heading', { name: 'File transfer queue' });
  });
});
