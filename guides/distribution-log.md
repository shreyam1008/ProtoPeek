# ProtoPeek distribution log

Canonical product URL: <https://protopeek.shreyam1008.com.np/>  
Repository: <https://github.com/shreyam1008/ProtoPeek>  
Last checked: 20 August 2026

| Channel | Version | Status | Evidence / next check |
| --- | --- | --- | --- |
| Product website | current public site | **Live** | Custom domain serves over HTTPS and the legacy Pages URL redirects to it. Candidate source changes are not live until merged and deployed. |
| GitHub Releases | v0.1.6 | **Live stable** | Public stable release exists but predates the rebuilt gRPC and HTTP workbench. |
| Release candidate | v0.2.0 | **Draft candidate; not published** | Packaging, installers, OS validation, SBOMs, and provenance must pass before a tag draft is manually published. |
| Edge release | v0.0.0-edge | **Rolling prerelease** | Public edge exists. The safer workflow in the candidate is not deployment evidence until merged and run. |
| Docker registry | — | **Not published** | The repository builds `protopeek:dev` locally; no public image is claimed. |
| Package managers | — | **Not published** | Homebrew, Scoop, WinGet, AUR, and Chocolatey remain outside the v0.2.0 release gate. |

Do not call v0.2.0 released until its draft archives, checksums, SBOMs,
attestations, Unix and Windows installers, website, and three-OS acceptance all
describe the same version and the draft is manually published.
