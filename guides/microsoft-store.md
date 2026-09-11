# Microsoft Store preparation

Checkpoint: 11 September 2026. **Reserved and in draft; not published or in certification.**

## Identity and package

- Store ID: `9MXQ75XW900Q`
- Package identity: `shreyam1008.ProtoPeek`
- Publisher: `CN=56C87ED7-40E5-4525-B1C3-5F8CD5E02720`
- Publisher display name: `shreyam1008`
- Family: `shreyam1008.ProtoPeek_ax0kgekbzfne6`
- [Owner dashboard](https://partner.microsoft.com/en-US/dashboard/products/9MXQ75XW900Q/overview)
- Submission 1: `1152921505701868198`

Use MSIX, Windows desktop x64, minimum Windows 10 build 19041. A browser UI does not require a PWA rewrite: the package contains the existing console application and opens the locally served UI. `protopeek.exe` and `pp.exe` are execution aliases. The console owns process lifetime. `runFullTrust` is required for the existing local server, files, OS network evidence and optional child tools.

The reserved future Store address must not be shown as an available download before anonymous verification of publication. The dashboard warns that names must be submitted within three months of reservation (11 December 2026 for this reservation).

## Build

```powershell
gh release download v0.6.1 --repo shreyam1008/ProtoPeek --pattern protopeek_0.6.1_windows_x86_64.zip --pattern checksums.txt --dir .local/store-input
./packaging/windows/store/build-store.ps1 -Tag v0.6.1 -ReleaseArchive .local/store-input/protopeek_0.6.1_windows_x86_64.zip -Checksums .local/store-input/checksums.txt
```

The script rejects prerelease tags, wrong filenames, absent/duplicate checksums, checksum mismatch, mismatched executable version, version components above 65535, and an existing output package. It retains release notices and resizes the established logo without editing the source. Windows SDK MakeAppx validates the manifest. The fourth MSIX version component stays zero: `v0.6.1` becomes `0.6.1.0`.

## Verified locally

- Official stable archive SHA-256: `b048abd632e62a453c257c053a401d5a2fc0cdebf399850589e710745894e887`.
- MakeAppx SDK 10.0.26100.0: package creation passed, including console manifest and aliases.
- Local package SHA-256: `fd094ed44825ffc71fb1b6a97e3a698cc60836362c11cde0f96a63a163a7a59c`.
- Developer registration through Add-AppxPackage succeeded; package status `Ok` and version `0.6.1.0`.
- Registered `protopeek` alias reports v0.6.1; its local server returns 200, the browser renders Home and Inspect, and a real HTTP request from the workbench returns 200.
- Registered `pp` alias also reports v0.6.1. The development package was removed successfully after the smoke check; the test process was stopped and deliverable files retained.
- Genuine local Home and HTTP screenshots saved in `dist/store/listing/`; no private endpoint or credentials displayed.
- `go test ./internal/selfupdate` passed for the source change directing WindowsApps installations to Microsoft Store updates.

Development registration is not a Store-signed installation test. Still test Start-menu launch/browser opening, clean machine Store installation, upgrade/uninstall, optional tool discovery, download paths and bundled aria2 under the installed WindowsApps location. Do not mark those passed from an unpackaged launch or a development registration.

## Submission progress

- Name reserved and draft created.
- Properties saved and shown Complete: Developer tools / Networking, canonical site, GitHub support, personal-information access declaration and full privacy text. v0.6.1 does not include generative AI. OneDrive backup/recording declarations disabled.
- MSIX and two screenshots prepared. Chrome file selection was blocked by extension file-URL access (`Not allowed`); no upload accepted at that checkpoint.
- English (United States) listing created and description, short description, primary feature and developer name saved. Listing remains Incomplete because screenshots have not been uploaded.
- Free USD 0 pricing, public worldwide availability (240 markets) saved; Pricing and availability is Complete.
- IARC questionnaire preview returned ESRB Everyone and PEGI/Store 3+. Final Save requires the owner's IARC Terms of Use/adult declaration; checkbox left untouched and review tab retained. Ratings are not yet saved.
- Store description, features, keywords, captions, release notes and full-trust certification explanation are in [listing copy](../packaging/windows/store/listing.md).
- Privacy text saved in [privacy-policy.txt](../packaging/windows/store/privacy-policy.txt).
- Finish pricing/markets, age ratings, package upload/device families, English listing and certification notes. Review any presented agreements with the owner before their acceptance.

## Release automation

`.github/workflows/store-package.yml` packages **published stable releases**, or an explicitly selected existing stable tag through workflow_dispatch. Waiting for `release.published` avoids the race where a tag exists but the release workflow is still building its draft. Rolling Nightly/Edge never enter this lane. The package is uploaded as a GitHub Actions artifact with an input/output checksum receipt; published GitHub release assets are not rewritten.

The checked-out packaging recipe comes from master and wraps unchanged release binaries. Record the workflow commit alongside the source release tag. This first lane builds artifacts only; it does not claim that automatic Store upload is configured.

First hosted run [34576442795](https://github.com/shreyam1008/ProtoPeek/actions/runs/34576442795) passed at workflow commit `763af48`. Its retained v0.6.1 MSIX SHA-256 is `a1bda2d48a4b27806ba784d75116d97e06dd3673e8e6b485ba6648db9ef103de`. The CI artifact was downloaded with its receipt. Local and CI package hashes differ because package generation is not claimed reproducible; both wrap the same verified release archive. Local source validation passed all 783 UI tests and `go test ./...`; lint reported existing warnings without errors.

For automatic Store updates, finish the first submission, associate a Microsoft Entra tenant with Partner Center, configure app-scoped API access, and store tenant/client credentials as GitHub environment secrets. Then add an environment-gated `msstore` upload/submission job and poll certification. Never put a client secret or an interactive Microsoft-account password into a workflow or documentation. Account verification alone does not provide this API setup.

References: [MSIX package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements), [console execution aliases](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap5-appexecutionalias), [Microsoft Store Developer CLI](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/overview).
