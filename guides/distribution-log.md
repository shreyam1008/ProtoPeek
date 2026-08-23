# ProtoPeek distribution log

Canonical product URL: <https://protopeek.shreyam1008.com.np/>  
Repository: <https://github.com/shreyam1008/ProtoPeek>  
Last externally checked: 21 August 2026

| Channel | Version | Status | Evidence / next check |
| --- | --- | --- | --- |
| v0.5.0 promotion | release source | **Prepared locally; not yet published** | Changelog, manuals, site metadata, and generated docs are aligned for the stable tag. Tag, draft assets, publication, Pages deployment, package manifests, and live checks remain separate gates. |
| Product website | v0.4.0 docs | **Live** | Custom-domain Pages deployment completed after the stable merge; the public site shows v0.4.0 and the Network Workbench surfaces. |
| GitHub Releases | v0.4.0 | **Live** | Published release contains platform archives, matching SBOMs, checksums, both installers, provenance, and accepted artifact checks. |
| Edge release | v0.0.0-edge | **Rolling prerelease** | Edge remains an explicit opt-in channel and is never a stable-resolution fallback. |
| Docker registry | — | **Not published** | The repository builds `protopeek:dev` locally; no public image is claimed. |
| Homebrew tap | v0.4.0 | **Live owned package** | Formula CI `32474236419` passed audit, install, test, linkage, both commands, and both manpages on macOS and Linux. |
| Scoop bucket | v0.4.0 | **Live owned package** | Bucket CI `32474236152` passed schema, checksum-backed install, both commands, update, uninstall, and three-architecture autoupdate checks. |
| WinGet | — | **Planned after feedback** | Prepare and owner-submit community manifests only after the owned Scoop path and installer have accumulated initial user feedback. |
| AUR / Chocolatey | — | **Not published** | Later candidates; no package is claimed. |

The verified public baseline remains v0.4.0. That release promotes the Network Workbench: native Linux path evidence, authorized private
discovery, logical topology, bounded exchange, and explicit provenance. The stable website, release
installers, archives, checksums, SBOMs, attestations, and both owned package channels are live after
their corresponding workflows completed. The prepared v0.5.0 source adds the six-area shell,
Downloader, Security evidence, and the GoBarryGo bridge, but this log must not mark those external
channels live until their tag, assets, deployment, and independent checks complete. WinGet and
community launch submissions remain gated on initial user feedback rather than being presented as shipped.
