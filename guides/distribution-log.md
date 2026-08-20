# ProtoPeek distribution log

Canonical product URL: <https://protopeek.shreyam1008.com.np/>  
Repository: <https://github.com/shreyam1008/ProtoPeek>  
Last checked: 20 August 2026

| Channel | Version | Status | Evidence / next check |
| --- | --- | --- | --- |
| Product website | v0.3.1 docs | **Live** | Custom domain serves the prerendered v0.3.1 site over HTTPS and the legacy Pages URL redirects each path to it. |
| GitHub Releases | v0.3.1 | **Live stable** | The public latest release has eight platform archives, eight matching SBOMs, checksums, both installers, and provenance for the archive/SBOM subjects. |
| Edge release | v0.0.0-edge | **Rolling prerelease** | Edge remains an explicit opt-in channel and is never a stable-resolution fallback. |
| Docker registry | — | **Not published** | The repository builds `protopeek:dev` locally; no public image is claimed. |
| Homebrew tap | v0.3.0 | **Live owned package** | `shreyam1008/tap/protopeek` pins the four macOS/Linux archives and installs both commands and manpages. |
| Scoop bucket | v0.3.0 | **Live owned package** | `shreyam/protopeek` pins all three Windows archives, exposes both shims, and carries a checked autoupdate contract. |
| WinGet | — | **Planned after feedback** | Prepare and owner-submit community manifests only after the owned Scoop path and installer have accumulated initial user feedback. |
| AUR / Chocolatey | — | **Not published** | Later candidates; no package is claimed. |

v0.3.1 is the current stable release of the protocol workbench. Its website, installers, archives,
checksums, SBOMs, attestations, and three-OS CI describe that version. The owned Homebrew and Scoop
definitions deliberately remain on v0.3.0 until their independent version bumps and package CI
pass; this lag is recorded rather than hidden.
