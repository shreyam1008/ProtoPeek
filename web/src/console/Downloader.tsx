import { lazy, Suspense, useState } from 'react';
import './download-workspace.css';
const FileDownloader = lazy(() => import('./FileDownloader'));
const MediaDownloader = lazy(() => import('./MediaDownloader'));

export function Downloader() {
  const [mode, setMode] = useState('files');
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
          <MediaDownloader />
        </Suspense>
      )}
    </div>
  );
}
