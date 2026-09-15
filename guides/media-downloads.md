# Media downloads — current source

Open **Files → Downloader → Media, galleries & webpages**. This implementation is
source work after v0.6.1, not a published release. Ordinary file transfers retain
their existing aria2 queue and CLI.

## What each option saves

| Option | Implementation | Capability |
| --- | --- | --- |
| Direct & page media | Native Go, no installation | Direct HTTP(S) files; image, video, audio and Open Graph links in HTML; original HTML snapshots |
| Video & audio | Optional yt-dlp | Supported video sites, YouTube URLs and bounded playlist ranges; original audio or video |
| Images & galleries | Optional gallery-dl | Supported image sites, galleries and albums |
| Webpage archive | Separately installed ArchiveBox | A dedicated local collection with title, HTML, screenshot and PDF extractors, subject to installed dependencies |

Go inspection reads at most 4 MiB of HTML and returns the first 100 unique media
links. It does not execute JavaScript, unlock protected content, render a page or
discover every image a browser could load. Original HTML snapshots leave linked
assets external. They are not self-contained offline archives. Use ArchiveBox
when a rendered webpage capture is needed.

Select positions 1–10000, at most 100 items per job. Each job gets a separate
`ProtoPeek-<id>` output directory. Two jobs can run concurrently; history is capped
at 128 jobs. Removing history preserves files. Downloads continue while ProtoPeek
is running, including after closing the page. Cancel stops native requests or the
external process tree. Retry preserves completed files; native incomplete files
restart, while external engines may resume their own partial formats. An app
restart leaves interrupted work stopped until explicitly retried.

## One-click setup

The install button fetches a pinned official build, checks its exact byte count
and SHA-256 digest, and stores it in the private ProtoPeek media tools directory.
It does not require a terminal, an authorization checkbox, Python installation or
an administrator prompt. The app uses the installed engine immediately.

Current managed builds and approximate compressed download sizes:

| Engine | Windows x64 | Linux x64 | macOS |
| --- | ---: | ---: | ---: |
| yt-dlp 2026.08.19 | 17 MiB | 39 MiB | 35 MiB |
| gallery-dl 1.32.12 | 21.5 MiB | 23 MiB | Install separately |
| Deno | 41 MiB | 40 MiB | 37–40 MiB |
| FFmpeg + ffprobe | 186 MiB | Install separately | Install separately |

Video setup includes missing managed FFmpeg and a JavaScript runtime when a local
Node installation is not available. The UI displays their combined download size.
The executable bundle is larger on disk after unpacking. No automatic update or
idle network check runs. `internal/media/tools.json` is the authoritative pinned
asset manifest. Linux ARM64 yt-dlp and Deno, plus both macOS architectures, are
also included. Other configurations show actual capability and installation help.

FFmpeg enables separate video/audio merging. Without it, video selection is
limited to a combined format. Audio keeps the source's native audio format;
there is no implicit MP3 conversion. Node must meet yt-dlp's supported runtime
version requirements. TLS verification stays enabled. User config files, arbitrary
command flags, external yt-dlp plugins and remote components are not loaded.

ArchiveBox has a larger Python/browser/tool stack and does not officially support
native Windows. ProtoPeek can invoke a separately installed compatible CLI on
Linux/macOS, with no recursive crawl and no Internet Archive submission. On
Windows the UI links to upstream Docker/WSL setup; it does not claim to install
Docker or enable Windows features. Its collection index reports per-format
success/failure; a completed command does not prove every requested format saved.

## Architecture and size

Go owns request validation, HTML extraction, streaming, the local queue,
installer verification, process cancellation and saved history. It adds no new
Go dependency. Media and file views load independently; neither optional Python
engine is embedded into the application binary. The new route has an 18 KiB raw
JavaScript budget; the aggregate allowance grows by this route and 4 KiB of CSS,
while startup and existing file-view limits remain unchanged.

Reimplementing the common path in Go keeps it small. Retaining maintained site
extractors avoids pretending that generic HTML parsing covers YouTube signatures,
site APIs or frequent platform changes. Speed depends on bandwidth, source limits,
format and post-processing; there is no universal speed guarantee.

References: [yt-dlp](https://github.com/yt-dlp/yt-dlp),
[gallery-dl](https://github.com/mikf/gallery-dl) (active releases on Codeberg),
[ArchiveBox](https://github.com/ArchiveBox/ArchiveBox),
[Cobalt](https://github.com/imputnet/cobalt). No Cobalt extractor code is copied.
External executables keep their own upstream licenses: gallery-dl is GPL-2.0,
FFmpeg builds have GPL components, ArchiveBox is MIT, and yt-dlp standalone
executables contain third-party components beyond its Unlicense source.
