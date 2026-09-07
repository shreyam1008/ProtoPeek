# ProtoPeek distribution log

## Verified edge overhaul — 7 September 2026

Implementation `197033801f7b2a229018d26937627e9dd53f0249` published through
[Edge Release 34121480924](https://github.com/shreyam1008/ProtoPeek/actions/runs/34121480924).
[CI 34121480901](https://github.com/shreyam1008/ProtoPeek/actions/runs/34121480901) and
[Pages 34121479824](https://github.com/shreyam1008/ProtoPeek/actions/runs/34121479824) passed.
The downloaded Windows ZIP matched SHA-256
`58cdcd752ebf7751d34701dfa52ff6af273742e34d8dcf32b68a1515ef01fc37`;
its Go 1.26.8 executable reports that exact VCS revision and `vcs.modified=false`.
This is a dated artifact checkpoint; the rolling edge checksum changes after later source commits.

Edge includes persistent grouped navigation, last-tool resume, shared workspace layouts, mobile
command search, new download-folder creation and local MCP/CLI agent access. Stable installers,
Homebrew and Scoop remain v0.6.1. See [UI acceptance](ui-overhaul-2026-09.md),
[agent acceptance](agent-acceptance-2026-09.md) and [feature roadmap](feature-roadmap.md).
Native Nmap execution and privileged live capture remain unverified. File upload acceptance now
covers a 75-packet PCAP and a compiled Cap’n Proto schema; old picker-blocker notes below are historical.

## Current stable release — 7 September 2026

**v0.6.1 is the latest stable release.** It supersedes the v0.6.0 candidate without rewriting
that tag. The candidate was returned to draft after publication checks caught an edge-tag collision.
Stable and edge publishers now select their exact tags; release binaries use patched Go 1.26.8.

| Channel | Version | Verified evidence |
| --- | --- | --- |
| GitHub Releases | v0.6.1 | [Release run 34100713350, attempt 2](https://github.com/shreyam1008/ProtoPeek/actions/runs/34100713350/attempts/2) passed at `89acab77d2d6fbff1533b4315f3920c4cb7d17a9`; public release has 23 assets. |
| Source CI | v0.6.1 | All ten [CI jobs 34100702952](https://github.com/shreyam1008/ProtoPeek/actions/runs/34100702952) passed: Windows/Linux/macOS Go checks, web, installers, container and package contracts. Follow-up [CI 34101191909](https://github.com/shreyam1008/ProtoPeek/actions/runs/34101191909) passed after fixing the HTTP persistence test wait. |
| Product website | v0.6.1 | [Pages 34100701482](https://github.com/shreyam1008/ProtoPeek/actions/runs/34100701482) passed; current install copy, manuals and feature roadmap identify v0.6.1. |
| Windows resolver | v0.6.1 | The public `irm .../master/install.ps1 | iex` command passed from System32 in Windows PowerShell 5.1.26100.9168 and PowerShell 7.6.5, with paths containing spaces. Installed executables match the accepted archive. |
| Homebrew | v0.6.1 | Commit `9fe2d4e9a8023bc0a6d9ac57bd5a9cace7c43865`; [CI 34102349839](https://github.com/shreyam1008/homebrew-tap/actions/runs/34102349839) passed audit/style/readall, installation, runtime, linkage and manuals on macOS and Ubuntu. |
| Scoop | v0.6.1 | Commit `70c3fdb1dc6e6a7a147f2634e744712dcf9f0150`; [CI 34102346356](https://github.com/shreyam1008/scoop-bucket/actions/runs/34102346356) passed manifest validation, installation/update/removal and all three architecture autoupdate checks. |
| Edge | v0.0.0-edge | [Edge 34100702842](https://github.com/shreyam1008/ProtoPeek/actions/runs/34100702842) passed and publishes only edge-named archives. It is never the stable installer fallback. |

The release contains eight platform archives, eight SPDX SBOMs, three Debian packages, checksums,
two installers and the aria2 source companion. All 19 checksum entries match verified GitHub
stable-workflow provenance. Windows x64 ZIP SHA-256:
`b048abd632e62a453c257c053a401d5a2fc0cdebf399850589e710745894e887`.
The 29,054,809-byte ZIP contains a 39,041,536-byte canonical executable, manuals and notices.
The source companion's seven archives match the repository's pinned manifest and checksums.

Windows x64 embeds aria2; other targets use an installed engine. Package managers still supply
aria2 as a dependency. Native capture, browser file-picker automation on the review host, native
macOS/Linux interactive acceptance, signed APT, WinGet and community launch moderation remain
separate gates. See the [acceptance record](workbench-overhaul-2026-09.md) and
[portfolio tracker](https://shreyam1008.com.np/projects/#distribution-protopeek).

## Historical checkpoint — 24 August 2026

Canonical product URL: <https://protopeek.shreyam1008.com.np/>  
Repository: <https://github.com/shreyam1008/ProtoPeek>  
Last externally checked: 24 August 2026

| Channel | Version | Status | Evidence / next check |
| --- | --- | --- | --- |
| v0.5.0 promotion | v0.5.0 | **Published** | Release workflow `32664226091` passed at merge `be0b1e0876fb7075e72b4485e9ebe774d6274222`; the stable release is public with 19 assets. |
| Product website | v0.5.0 docs | **Live** | Pages deployment `32664204617` passed at the same merge; the custom origin serves the v0.5.0 site and crawlable `/downloader/` page. Search Console evidence remains separate. |
| GitHub Releases | v0.5.0 | **Live** | Published release contains eight platform archives, eight matching SBOMs, checksums, both installers, and provenance attestations. |
| Edge release | v0.0.0-edge | **Rolling prerelease** | Edge remains an explicit opt-in channel and is never a stable-resolution fallback. |
| Docker registry | — | **Not published** | The repository builds `protopeek:dev` locally; no public image is claimed. |
| Homebrew tap | v0.5.0 | **Live owned package** | PR `shreyam1008/homebrew-tap#4` merged as `291f2240732190d874e67f8fd2b967f5fd95fb9e`; post-merge CI `32665001084` passed on macOS and Ubuntu with the external aria2 dependency. |
| Scoop bucket | v0.5.0 | **Live owned package** | PR `shreyam1008/scoop-bucket#6` merged as `4b4d5fb0feff342c431e1bcfe26c7d53a3750996`; post-merge CI `32664865170` passed with the external aria2 dependency. |
| GoBarryGo compatibility | v0.0.9 → v0.5.0 | **Compatibility page live; redirect disabled** | GoBarryGo PR `#3` merged as `144c725c`; Pages deployment `32665465437` passed while the legacy release, checksums, source, and migration links remain available. |
| WinGet | — | **Planned after feedback** | Prepare and owner-submit community manifests only after the owned Scoop path and installer have accumulated initial user feedback. |
| AUR / Chocolatey | — | **Not published** | Later candidates; no package is claimed. |

The verified public baseline is v0.5.0: the six-area shell, Downloader, Security evidence, and the
GoBarryGo bridge are public through the stable website, release installers, immutable archives,
checksums, SBOMs, attestations, Homebrew, and Scoop. The package definitions declare aria2 as an
external dependency; ProtoPeek does not bundle aria2. Search Console indexing, the GoBarryGo
permanent redirect, WinGet, and community launch submissions remain separate gates rather than
being presented as shipped.
