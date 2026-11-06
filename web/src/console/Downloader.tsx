import { useSearch } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useState } from 'react';
import { publishDownloadMode } from './download-mode';
import './download-workspace.css';
const FileDownloader = lazy(() => import('./FileDownloader'));
const MediaDownloader = lazy(() => import('./MediaDownloader'));

export function Downloader() {
  const { mediaTool } = useSearch({ from: '/downloader' });
  const [mode, setMode] = useState<'files' | 'media'>(mediaTool ? 'media' : 'files');
  useEffect(() => {
    if (mediaTool) setMode('media');
  }, [mediaTool]);
  useEffect(() => {
    publishDownloadMode(mode);
  }, [mode]);
  useEffect(() => () => publishDownloadMode('files'), []);
  return (
    <div className="pp-download-workspace">
      <nav className="pp-download-modes" aria-label="Download type">
        <button type="button" aria-pressed={mode === 'files'} onClick={() => setMode('files')}>
          Files
        </button>
        <button type="button" aria-pressed={mode === 'media'} onClick={() => setMode('media')}>
          Media, galleries & webpages
        </button>
      </nav>
      {mode === 'files' ? (
        <Suspense fallback={<p role="status">Loading file downloader…</p>}>
          <FileDownloader />
        </Suspense>
      ) : (
        <Suspense fallback={<p role="status">Loading media downloader…</p>}>
          <MediaDownloader initialTool={mediaTool} />
        </Suspense>
      )}
    </div>
  );
}
