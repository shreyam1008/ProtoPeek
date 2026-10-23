#!/usr/bin/env bash
# Install only on a disposable hosted Linux runner; preserve any existing app.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
tag="${1:?exact stable tag required}"
asset="${2:?verified Snap path required}"
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
test -f "$asset"
if snap list protopeek >/dev/null 2>&1; then
  echo 'A ProtoPeek Snap already exists; refusing replacement.' >&2
  exit 1
fi
installed=false
cleanup() {
  if "$installed"; then sudo snap remove --purge protopeek; fi
}
trap cleanup EXIT
sudo snap install --classic --dangerous "$asset"
installed=true
for command in protopeek protopeek.pp; do
  actual="$(snap run "$command" --version 2>&1)"
  [[ "$actual" == *" $tag" ]]
  printf '%s\n' "$actual"
done
sudo snap remove --purge protopeek
installed=false
if snap list protopeek >/dev/null 2>&1; then
  echo 'ProtoPeek Snap remains installed after removal.' >&2
  exit 1
fi
echo 'Actual classic Snap installation, both commands and removal passed.'
