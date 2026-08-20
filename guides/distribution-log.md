# ProtoPeek distribution log

Canonical product URL: <https://protopeek.shreyam1008.com.np/>  
Repository: <https://github.com/shreyam1008/ProtoPeek>  
Last checked: 20 August 2026

| Channel | Version | Status | Evidence / next check |
| --- | --- | --- | --- |
| Product website | v0.2.0 docs | **Live** | Custom domain serves the prerendered gRPC + HTTP site over HTTPS and the legacy Pages URL redirects to it. |
| GitHub Releases | v0.2.0 | **Live stable** | Eight archives provide both commands across Linux, macOS, and Windows, with checksums, SBOMs, and provenance attestations. |
| Edge release | v0.0.0-edge | **Rolling prerelease** | Edge remains an explicit opt-in channel and is never a stable-resolution fallback. |
| Docker registry | — | **Not published** | The repository builds `protopeek:dev` locally; no public image is claimed. |
| Package managers | — | **Not published** | Homebrew, Scoop, WinGet, AUR, and Chocolatey remain outside the v0.2.0 release gate. |

v0.2.0 is the first stable release of the rebuilt gRPC and HTTP workbench. Its
website, installers, archives, checksums, SBOMs, attestations, and three-OS CI
describe the same version.
