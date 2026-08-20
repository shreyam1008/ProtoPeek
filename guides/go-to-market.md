# ProtoPeek go-to-market runbook

ProtoPeek should launch as a small, inspectable developer tool—not as a vague
"Postman for everything." The first public promise is narrower and testable:

> One local binary. Open a browser. Inspect gRPC or HTTP, read the kernel-selected next hop, and
> verify offline discovery hints without moving credentials or history to a hosted service.

## Release gate

Do not send launch traffic to `master`, an edge build, or a draft. Launch only
after all of these are true for the same stable tag:

- GitHub Actions passes on Linux, macOS, and Windows.
- The draft contains eight OS/architecture archives, checksums, SBOMs, and
  provenance attestations.
- `protopeek` and `pp` start correctly from clean Linux, macOS, and Windows
  installs; upgrades and uninstall are also checked.
- The website, README, installers, changelog, and structured data name the same
  public version.
- The three-minute path works: install, run `pp`, find a local service or enter
  a target, make one request, inspect the result.

[GitHub Releases are tag-based deployable software packages](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases),
so the stable tag is the immutable center of this launch—not the website copy.

## Distribution order

Current execution state: **deferred until the v0.3 stable archives and checksums exist**. A formula
or manifest published earlier would either point at v0.2 or at mutable preview artifacts. No
third-party submission or founder-authored community post should be made from an agent account.

### 1. Direct release: day zero

- Publish the tested GitHub release and deploy the matching website.
- Keep the verified shell and PowerShell installers as the canonical paths.
- Update Shreyam's portfolio entry from “gRPC Tooling” to “local gRPC + HTTP
  protocol workbench.”
- Submit the custom-domain sitemap in Google Search Console after deployment.

The first goal is not maximum reach. It is proving that real users on all three
desktop operating systems can install and reach a successful request.

### 2. Native package discovery: after the stable assets hold

| Channel | Why it earns a place | Release rule |
| --- | --- | --- |
| Homebrew tap | Best first macOS/Linux package path; a tap can live in a GitHub `homebrew-*` repository. | Publish a formula pinned to a stable archive and checksum; test Intel and Apple Silicon. Follow the [tap contract](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap). |
| Scoop bucket | Lightweight Windows developer distribution with a JSON manifest. | Start in ProtoPeek's own bucket, verify both architectures, then consider a community bucket. Follow [Scoop's bucket guidance](https://github.com/ScoopInstaller/Scoop/wiki/Buckets). |
| WinGet | Native Windows search and upgrade path. | Submit only after the PowerShell installer and release URLs are stable. Microsoft requires a schema-valid manifest, sandbox test, and PR review; use the [official submission flow](https://learn.microsoft.com/en-us/windows/package-manager/package/repository). |
| AUR | Useful later for Arch users who accept source/community packaging. | Add after one patch release proves the stable layout; keep the PKGBUILD small and reproducible. Follow the [AUR submission rules](https://wiki.archlinux.org/title/AUR_submission_guidelines). |

Use owned repositories first so package updates remain reversible and testable:

1. `shreyam1008/homebrew-tap`: add `Formula/protopeek.rb`, pin each macOS/Linux archive by version
   and SHA-256, install both `protopeek` and `pp`, and run `brew audit --strict --online` plus an
   actual `pp -version` smoke test on Intel and Apple Silicon.
2. `shreyam1008/scoop-protopeek`: add `bucket/protopeek.json`, pin amd64 and arm64 Windows ZIPs and
   hashes, expose both binaries, declare `checkver`/`autoupdate`, then test clean install, update,
   shim resolution, and uninstall in Windows Sandbox.
3. WinGet community manifests: generate version, installer, and locale YAML only after the owned
   Scoop path and PowerShell installer have survived user feedback. Validate with `winget validate`
   and Windows Sandbox before Shreyam submits the PR from his account.

Release automation may open draft changes in the two owned repositories after assets exist. It
must stop before creating a WinGet/community PR unless Shreyam explicitly approves the exact
manifest and public text.

Do not create an npm package for a Go desktop binary. Do not advertise a
Docker image until one is actually published, signed, documented, and useful
for the loopback/browser model.

### 3. Technical communities: after package smoke tests and initial user feedback

Launch sequence: **Show HN → awesome-grpc → Product Hunt**. The first two should wait until a new
user can install and complete a request without maintainer help; Product Hunt waits until the first
support fixes and screenshots are in the stable release.

- Prepare (then let Shreyam open) a focused contribution to
  [awesome-grpc](https://github.com/grpc-ecosystem/awesome-grpc) under GUI or
  debugging tools. The submission should state capabilities and limits, not
  repeat landing-page copy.
- Write one technical walkthrough: why reflection can be absent, how ProtoPeek
  distinguishes “gRPC without reflection” from “not gRPC,” and how it keeps
  metadata, headers, trailers, and status visible.
- Share that walkthrough where it is genuinely on-topic: the gRPC community,
  Go developer channels, and relevant subreddits after reading each channel's
  current self-promotion rules.
- Submit Show HN first, only when the stable build is runnable without signup. The
  [Show HN rules](https://news.ycombinator.com/showhn.html) explicitly require
  something people can try and prohibit vote solicitation. Shreyam should
  write the post and replies personally, in his own voice.

### 4. Broad launch: after first-user feedback

Use Product Hunt only after direct installs, screenshots, onboarding, and the
first support fixes are proven. Its [official launch guide](https://www.producthunt.com/launch)
allows makers to launch their own work and recommends measurable goals; no paid
hunter is needed. Prepare:

- one clear tagline;
- the real 1200 by 630 social card and three product screenshots;
- a 30–45 second silent install-to-first-request recording;
- a founder comment covering the problem, local-first boundary, shipped
  protocols, and honest roadmap;
- active support coverage for the launch day and following morning.

## Launch messages

Use one factual spine, then write for the channel:

- **Tagline:** Inspect the protocol, not just the payload.
- **One sentence:** ProtoPeek is a single local binary that opens a browser
  workbench for discovering and invoking gRPC services and sending HTTP
  requests while preserving protocol-native evidence.
- **Proof:** no account, local history, secret-safe exports, bounded discovery, read-only next-hop
  evidence, offline Nmap XML import, verified installers, and native gRPC/HTTP response views.
- **Boundary:** next-hop is not traceroute; Nmap import does not execute Nmap. Active Nmap,
  traceroute/hop probes, LAN expansion, and live capture remain gated.

Never paste the same launch paragraph everywhere. Never claim “all protocols,”
“zero configuration,” benchmarks that were not measured, or packages that are
not live.

## What to measure

Keep the binary free of invasive analytics. Use public and voluntary signals:

- release downloads by OS and architecture;
- installer and startup failures reported through issues;
- time-to-first-success from five moderated install sessions;
- percentage of those sessions that discover a service without documentation;
- issue quality, repeat contributors, package installs, and useful discussion;
- website search impressions for the custom domain after sitemap submission.

The two-week decision is simple: fix installation and first-request failures
before adding another protocol. Start the Cap'n Proto slice only after the
shipped gRPC and HTTP paths are boringly reliable.

## Owner checklist

Shreyam owns the release publish button, community accounts, replies, and the
truth of every public claim. Automation may assemble artifacts and drafts; it
must not impersonate the founder in community posts or solicit engagement.
