#!/usr/bin/env bash
# Run after verify-rolling-assets.sh in the Linux publication job.
set -euo pipefail
tag=${1:?rolling tag required}
case "$tag" in v0.0.0-nightly|v0.0.0-edge) ;; *) echo "Unexpected rolling tag: $tag" >&2; exit 2 ;; esac
[[ $(uname -s)/$(uname -m) == Linux/x86_64 ]]
[[ $(git rev-parse HEAD) == "${GITHUB_SHA:?}" ]]
work=$(mktemp -d "${RUNNER_TEMP:?}/rolling-linux-install.XXXXXX")
home="$work/home"
mkdir -p "$home" "$work/temp"
archive="protopeek_${tag#v}_linux_x86_64.tar.gz"
release_url="https://github.com/${GITHUB_REPOSITORY:?}/releases/download/$tag"
for file in install.sh checksums.txt; do
  env -i HOME="$home" PATH="$PATH" curl -q --fail --silent --show-error --location \
    --proto '=https' --proto-redir '=https' --retry 2 --connect-timeout 10 --max-time 90 \
    --max-filesize 1048576 --output "$work/$file" "$release_url/$file"
done
git cat-file blob "$GITHUB_SHA:install.sh" | cmp - "$work/install.sh"
cmp dist/checksums.txt "$work/checksums.txt"
verify_file() {
  local expected
  expected=$(awk -v name="$1" '{ file=$2; sub(/^\*/, "", file); if (file==name) { print $1; n++ } } END { if (n != 1) exit 1 }' "$work/checksums.txt")
  printf '%s  %s\n' "$expected" "$2" | sha256sum --check
}
verify_file install.sh "$work/install.sh"
verify_file "$archive" "dist/$archive"

# Let the real channel resolver fetch its public archive. Pin the already
# verified public manifest so a concurrent rolling-tag change fails before execution.
isolated=(env -i HOME="$home" PATH="$PATH" TMPDIR="$work/temp")
"${isolated[@]}" PROTOPEEK_REPO="$GITHUB_REPOSITORY" PROTOPEEK_CHANNEL="${tag##*-}" \
  PROTOPEEK_CHECKSUM_URL="file://$work/checksums.txt" timeout 180 sh "$work/install.sh"
for name in pp protopeek; do
  installed="$home/.local/bin/$name"
  expected=$(tar -xOzf "dist/$archive" "$name" | sha256sum | cut -d ' ' -f 1)
  printf '%s  %s\n' "$expected" "$installed" | sha256sum --check
  version=$("${isolated[@]}" timeout 15 "$installed" --version 2>&1)
  [[ ${version##* } == "$tag" ]]
  go version -m "$installed" > "$work/$name.buildinfo"
  grep -Fxq $'\tbuild\tvcs.revision='"$GITHUB_SHA" "$work/$name.buildinfo"
done
"${isolated[@]}" timeout 20 "$home/.local/bin/pp" extensions status aria2 \
  | python3 -c 'import json, sys; t = json.load(sys.stdin); sys.exit(0 if t.get("id") == "aria2" and t.get("status") else "Invalid managed extension receipt")'
printf 'Verified anonymous %s Linux installation and both native aliases at %s\n' "$tag" "$GITHUB_SHA"
