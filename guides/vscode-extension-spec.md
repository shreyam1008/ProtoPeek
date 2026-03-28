# ProtoPeek VS Code / Open VSX Extension Spec

Goal: ship a helper extension that stays under roughly 1 MB unpacked while still being useful.

## Scope

- Detect `.proto` files and surface a “Open in ProtoPeek” command.
- Let users configure a default target such as `localhost:50051`.
- Offer quick actions for:
  - Run `protopeek -plaintext localhost:50051`
  - Open the learn page
  - Open the current workspace export

## What not to include

- No embedded browser engine.
- No large icon packs.
- No bundled protobuf compiler.
- No full request authoring inside the extension.

The extension should stay a launch-and-link helper, not a second client implementation.

## Suggested files

- `extension.ts`
- `package.json`
- `media/icon.png`

## Suggested commands

- `protopeek.open`
- `protopeek.openWithTarget`
- `protopeek.learnGrpc`

## Suggested agent rules

- Never parse protos in the extension when the CLI can do it.
- Prefer shelling out to `protopeek` instead of duplicating transport logic.
- Keep command strings transparent and editable by the user.
- Make failure states actionable: missing binary, reflection disabled, target unreachable.
