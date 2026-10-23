#!/usr/bin/env bash
# Run from the checked-out release root before Snapcraft copies its local source.
set -euo pipefail
test -f snap/snapcraft.yaml
test -d web/site/public/man
# An unsuccessful preparation must not leave an earlier version usable.
rm -f -- .protopeek-release-version
tag="${1:?exact stable tag required}"
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
for command in protopeek pp; do
  title="$(awk -F '"' 'NR == 1 {print $4}' "web/site/public/man/$command.1")"
  test "$title" = "ProtoPeek ${tag#v}"
done
printf '%s\n' "$tag" > .protopeek-release-version
