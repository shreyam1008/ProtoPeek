#!/usr/bin/env bash
# Verify the built bytes before either release path can upload a Snap.
set -euo pipefail
tag="${1:?stable tag required}"
snap_path="${2:?built Snap path required}"
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
version="${tag#v}"
asset="protopeek_${version}_amd64.snap"
test -f "$snap_path"
mkdir -p dist
cp "$snap_path" "dist/$asset"
snap_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/protopeek-snap.XXXXXXXX")"
trap 'rm -rf -- "$snap_root"' EXIT
unsquashfs -d "$snap_root/root" "dist/$asset"
snap_version="$(awk '$1 == "version:" {print $2}' "$snap_root/root/meta/snap.yaml" | tr -d "\"'")"
test "$snap_version" = "$version"
for command in protopeek pp; do
  actual_version="$("$snap_root/root/bin/$command" --version 2>&1)"
  [[ "$actual_version" == *" $tag" ]]
  test "$(awk -F '"' 'NR == 1 {print $4}' "$snap_root/root/usr/share/man/man1/$command.1")" = "ProtoPeek $version"
done
for license in go-capnp-MIT.txt zeropool-APACHE-2.0.txt quic-go-MIT.txt qpack-MIT.txt; do
  cmp "third_party/licenses/$license" "$snap_root/root/usr/share/doc/protopeek/licenses/$license"
done
(cd dist && sha256sum "$asset" > "${asset}.sha256" && sha256sum --check "${asset}.sha256")
