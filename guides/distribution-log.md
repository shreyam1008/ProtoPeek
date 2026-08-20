# ProtoPeek distribution log

Canonical product URL: <https://protopeek.shreyam1008.com.np/>  
Repository: <https://github.com/shreyam1008/ProtoPeek>  
Last checked: 21 August 2026

| Channel | Version | Status | Evidence / next check |
| --- | --- | --- | --- |
| Product website | v0.3.2 docs | **Live** | Custom domain serves the prerendered v0.3.2 site over HTTPS and the legacy Pages URL redirects each path to it. |
| GitHub Releases | v0.3.2 | **Live stable** | The public latest release has eight platform archives, eight matching SBOMs, checksums, both installers, and provenance for the archive/SBOM subjects. |
| Edge release | v0.0.0-edge | **Rolling prerelease** | Edge remains an explicit opt-in channel and is never a stable-resolution fallback. |
| Docker registry | — | **Not published** | The repository builds `protopeek:dev` locally; no public image is claimed. |
| Homebrew tap | v0.3.2 | **Live owned package** | Main `f2327f41` pins all four macOS/Linux archives; Formula CI `32410092047` passed audit, install, test, linkage, both commands, and both manpages on macOS and Linux. |
| Scoop bucket | v0.3.2 | **Live owned package** | Main `6f004715` pins all three Windows archives; Bucket CI `32409763018` passed schema, install, both commands, update, uninstall, and three-architecture autoupdate checks. |
| WinGet | — | **Planned after feedback** | Prepare and owner-submit community manifests only after the owned Scoop path and installer have accumulated initial user feedback. |
| AUR / Chocolatey | — | **Not published** | Later candidates; no package is claimed. |

v0.3.2 is the current stable release of the protocol workbench. Its website, release installers,
archives, checksums, SBOMs, attestations, three-OS CI, and owned Homebrew and Scoop definitions now
describe that version. WinGet and community launch submissions remain gated on initial user
feedback rather than being presented as shipped.
