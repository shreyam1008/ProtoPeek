# ProtoPeek v0.3.2 release notes

Released 21 August 2026.

## Highlights

- Health Watch duration ownership is now unambiguous. ProtoPeek keeps the 1–600 second Watch wall
  inside the relay instead of propagating it as a downstream gRPC deadline.
- Terminal ownership is frozen before trailer collection. A server-returned `DeadlineExceeded` or
  `Canceled` status remains server RPC evidence even if the local duration fires or the browser
  disconnects while trailers are being retained.
- The owned Homebrew tap and Scoop bucket were promoted to v0.3.1 after their independent
  default-branch install, update, uninstall, checksum, and multi-architecture checks passed.

## Safety and compatibility notes

- Only a cancellation owned by ProtoPeek's Watch-duration timer is normalized to
  `duration-limit` with `DeadlineExceeded` evidence. Server-originated failures retain their gRPC
  code and are labeled `rpc-error`.
- Request cancellation remains a separate local `canceled` outcome when it owns the stop. Watch
  still performs no polling or retry, shares four stream slots, retains bounded metadata, and emits
  at most 512 observations.
- This patch changes no workspace, target, history, collection, environment, browser-folder, or
  export storage format and adds no database or account requirement.

## Distribution changes

- The stable release contains eight platform archives, eight matching SPDX SBOMs, checksums, the
  Unix and PowerShell installers, and build-provenance attestations.
- Homebrew and Scoop remain checksum-pinned to v0.3.1 until immutable v0.3.2 assets are public and
  their package-specific pull-request and default-branch checks pass. WinGet remains gated on
  initial user feedback.

## Compatibility

- `protopeek` remains the primary command and `pp` remains the short alias. The temporary `grpcui`
  compatibility command is unchanged.
- Natural Health Watch headers, observations, trailers, and final server status remain unchanged
  when the server finishes before a local stop.
