#!/usr/bin/env bash
# A published release must never have its assets replaced by a workflow retry.
set -euo pipefail

mode=${1:?expected allow-absent or require-draft}
tag=${TAG:?release tag required}
repository=${GITHUB_REPOSITORY:?repository required}
if [[ ! "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo 'Expected a stable version tag.' >&2
  exit 1
fi

# The list endpoint includes drafts visible to the workflow token. The tag
# endpoint alone does not reliably identify an unpublished draft.
state=$(gh api --paginate "repos/$repository/releases?per_page=100" --jq \
  '.[] | select(.tag_name == env.TAG) | if .draft == true then "draft" else "published" end')

case "$mode:$state" in
  allow-absent:|allow-absent:draft|require-draft:draft)
    printf 'Release %s is %s.\n' "$tag" "${state:-absent}"
    ;;
  *)
    printf 'Refusing to upload %s assets: release state is %s.\n' "$tag" "${state:-absent}" >&2
    exit 1
    ;;
esac
