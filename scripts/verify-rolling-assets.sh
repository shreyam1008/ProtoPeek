#!/usr/bin/env bash
# Compare GitHub's uploaded rolling assets to the exact local checksum manifest.
set -euo pipefail

tag=${1:?rolling tag required}
case "$tag" in v0.0.0-edge|v0.0.0-nightly) ;; *) echo 'Expected an Edge or Nightly tag.' >&2; exit 2 ;; esac
manifest=${2:-dist/checksums.txt}
work=$(mktemp -d "${RUNNER_TEMP:?}/rolling-assets.XXXXXX")
gh release download "$tag" --repo "${GITHUB_REPOSITORY:?}" --pattern checksums.txt --dir "$work"
cmp "$manifest" "$work/checksums.txt"
release_id=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag" --jq '.id')
gh api --paginate "repos/$GITHUB_REPOSITORY/releases/$release_id/assets?per_page=100" \
  --jq '.[] | "\(.digest | ltrimstr("sha256:"))  \(.name)"' | LC_ALL=C sort > "$work/uploaded"
{
  awk '{ name=$2; sub(/^\*/, "", name); print $1 "  " name }' "$manifest"
  printf '%s  checksums.txt\n' "$(sha256sum < "$work/checksums.txt" | cut -d ' ' -f 1)"
} | LC_ALL=C sort > "$work/expected"
diff -u "$work/expected" "$work/uploaded"
