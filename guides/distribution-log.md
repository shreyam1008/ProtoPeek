# ProtoPeek distribution log

Canonical product URL: <https://protopeek.shreyam1008.com.np/>  
Repository: <https://github.com/shreyam1008/ProtoPeek>  
Last checked: 21 August 2026

| Channel | Version | Status | Evidence / next check |
| --- | --- | --- | --- |
| Product website | v0.4.0 docs | **Pending release** | Source is prepared for the v0.4.0 custom-domain deployment; verify the public custom domain after the stable tag and Pages build complete. |
| GitHub Releases | v0.4.0 | **Pending release** | The release workflow will publish eight platform archives, matching SBOMs, checksums, both installers, and provenance after the tag reaches `master`. |
| Edge release | v0.0.0-edge | **Rolling prerelease** | Edge remains an explicit opt-in channel and is never a stable-resolution fallback. |
| Docker registry | — | **Not published** | The repository builds `protopeek:dev` locally; no public image is claimed. |
| Homebrew tap | v0.3.2 | **Live owned package** | The owned formula remains pinned to v0.3.2 until v0.4.0 release checksums are available for its independent audit/install/test/linkage gate. |
| Scoop bucket | v0.3.2 | **Live owned package** | The owned bucket remains pinned to v0.3.2 until v0.4.0 release checksums are available for its install/update/uninstall/autoupdate gate. |
| WinGet | — | **Planned after feedback** | Prepare and owner-submit community manifests only after the owned Scoop path and installer have accumulated initial user feedback. |
| AUR / Chocolatey | — | **Not published** | Later candidates; no package is claimed. |

The v0.4.0 source release promotes the Network Workbench: native Linux path evidence, authorized
private discovery, logical topology, bounded exchange, and explicit provenance. The stable website,
release installers, archives, checksums, SBOMs, attestations, and package channels are published
only after their corresponding workflows complete. WinGet and community launch submissions remain
gated on initial user feedback rather than being presented as shipped.
