#!/usr/bin/env bash
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/prepare-snap-version.sh"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/web/site/public/man" "$fixture/snap"
touch "$fixture/snap/snapcraft.yaml"
for command in protopeek pp; do
  printf '.TH %s 1 "October 2026" "ProtoPeek 1.2.3"\n' "$command" > "$fixture/web/site/public/man/$command.1"
done
cd "$fixture"
bash "$script" v1.2.3
test "$(cat .protopeek-release-version)" = v1.2.3
for invalid in v1.2.3-preview 1.2.3 v01.2.3 v1.2.4; do
  # Every negative starts with stale state, which must be invalidated.
  printf 'v1.2.3\n' > .protopeek-release-version
  if bash "$script" "$invalid"; then
    echo "Invalid or mismatched version accepted: $invalid" >&2
    exit 1
  fi
  test ! -e .protopeek-release-version
done
printf 'v1.2.3\n' > .protopeek-release-version
printf '.TH pp 1 "October 2026" "ProtoPeek 1.2.2"\n' > web/site/public/man/pp.1
if bash "$script" v1.2.3; then
  echo 'Mismatched alias manual accepted' >&2
  exit 1
fi
test ! -e .protopeek-release-version
echo 'Snap version handoff: exact tag accepted; prerelease, malformed, stale and mismatched manuals rejected.'
