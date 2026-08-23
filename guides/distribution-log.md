# ProtoPeek distribution log

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
