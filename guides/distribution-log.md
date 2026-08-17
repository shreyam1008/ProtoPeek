# ProtoPeek distribution log

Canonical product URL: <https://protopeek.shreyam1008.com.np/>  
Repository: <https://github.com/shreyam1008/ProtoPeek>  
Last checked: 17 August 2026

| Channel | Version | Status | Evidence / next check |
| --- | --- | --- | --- |
| Product website | unreleased rebuild | **Prepared; not deployed** | Canonical source metadata is prepared for the custom domain. Deploy only after main-branch checks pass. |
| GitHub Releases | v0.1.6 | **Live** | Public release exists, but it predates the local-console rebuild. |
| Edge releases | — | **Blocked** | Recent edge workflows failed; repair separately before using them as distribution evidence. |
| Docker registry | — | **Not published by this work** | The repository builds a local image; no current public registry listing is claimed. |
| Package managers | — | **Not prepared** | Homebrew/Scoop/WinGet/package-store listings are outside the current release gate. |

Do not call the rebuilt console released until one stable tag, checksums, public
artifacts, installer smoke test, and site all describe the same version.
