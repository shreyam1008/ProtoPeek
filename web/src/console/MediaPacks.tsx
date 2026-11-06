import { Link } from '@tanstack/react-router';
import { ArrowRight, Download, Pin } from 'lucide-react';

export type MediaPack = {
  id: 'yt-dlp' | 'gallery-dl' | 'deno' | 'ffmpeg';
  name: string;
  description: string;
  keywords: string;
  platforms: string;
};

export const mediaPacks: MediaPack[] = [
  {
    id: 'yt-dlp',
    platforms: 'Windows x64, Linux x64, Linux ARM64, macOS x64, macOS ARM64',
    name: 'yt-dlp',
    description: 'Save supported video, audio and playlists.',
    keywords: 'video audio youtube playlist extractor',
  },
  {
    id: 'gallery-dl',
    platforms: 'Windows x64, Linux x64',
    name: 'gallery-dl',
    description: 'Save supported image galleries and albums.',
    keywords: 'images gallery photos album extractor',
  },
  {
    id: 'deno',
    platforms: 'Windows x64, Linux x64, Linux ARM64, macOS x64, macOS ARM64',
    name: 'Deno',
    description: 'JavaScript runtime for supported video extractors.',
    keywords: 'javascript runtime youtube yt-dlp video',
  },
  {
    id: 'ffmpeg',
    platforms: 'Windows x64',
    name: 'FFmpeg',
    description: 'Merge video and audio streams for media downloads.',
    keywords: 'video audio merge converter yt-dlp',
  },
];

export function matchingMediaPacks(query: string): MediaPack[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return mediaPacks.filter((pack) =>
    tokens.every((token) =>
      `${pack.id} ${pack.name} ${pack.description} ${pack.keywords} media download`
        .toLowerCase()
        .includes(token)
    )
  );
}

export function PinExtension({
  name,
  pinned,
  onPin,
}: {
  name: string;
  pinned: boolean;
  onPin: () => void;
}) {
  return (
    <button
      type="button"
      className="pp-extension-pin"
      aria-pressed={pinned}
      aria-label={(pinned ? 'Unpin ' : 'Pin ') + name}
      onClick={onPin}
    >
      <Pin aria-hidden="true" />
    </button>
  );
}

export function MediaPacks({
  packs,
  pinned,
  onPin,
}: {
  packs: MediaPack[];
  pinned: readonly string[];
  onPin: (id: MediaPack['id']) => void;
}) {
  if (!packs.length) return null;
  return (
    <section aria-label="Media download companions">
      <h2>Media download companions</h2>
      <p>Install or remove individual companions in Files.</p>
      <div className="pp-extension-grid">
        {packs.map((pack) => (
          <article className="pp-panel pp-extension-card" key={pack.id}>
            <div className="pp-extension-card-heading">
              <Download aria-hidden="true" />
              <div>
                <h3>{pack.name}</h3>
                <span>Media</span>
              </div>
              <PinExtension
                name={pack.name}
                pinned={pinned.includes(pack.id)}
                onPin={() => onPin(pack.id)}
              />
            </div>
            <p>{pack.description}</p>
            <p>
              <strong>Managed setup:</strong> {pack.platforms}. Other hosts use PATH.
            </p>
            <div className="pp-extension-actions">
              <Link to="/downloader" search={{ mediaTool: pack.id }} preload={false}>
                Open setup in Files <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
