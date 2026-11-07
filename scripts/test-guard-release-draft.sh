#!/usr/bin/env bash
set -euo pipefail

fixture=$(mktemp -d)
trap 'rm -f "$fixture/gh" "$fixture/releases.json"; rmdir "$fixture"' EXIT
cat > "$fixture/gh" <<'EOF'
#!/usr/bin/env bash
if [[ ${RELEASE_TEST_API_FAILURE:-0} == 1 ]]; then exit 1; fi
cat "$RELEASE_TEST_FIXTURE"
EOF
chmod +x "$fixture/gh"
export PATH="$fixture:$PATH" TAG=v1.2.3 GITHUB_REPOSITORY=fixture/repository
export RELEASE_TEST_FIXTURE="$fixture/releases.json"

check() {
  local mode=$1 json=$2 expected=$3
  printf '%s' "$json" > "$RELEASE_TEST_FIXTURE"
  if bash scripts/guard-release-draft.sh "$mode" >/dev/null 2>&1; then
    [[ $expected == pass ]] || { echo "unexpected acceptance: $mode $json" >&2; exit 1; }
  else
    [[ $expected == fail ]] || { echo "unexpected rejection: $mode $json" >&2; exit 1; }
  fi
}

check allow-absent '' pass
check require-draft '' fail
check allow-absent 'draft' pass
check require-draft 'draft' pass
check allow-absent 'published' fail
check require-draft 'published' fail
check allow-absent $'draft\ndraft' fail
check allow-absent 'unexpected' fail
export RELEASE_TEST_API_FAILURE=1
check allow-absent '' fail
unset RELEASE_TEST_API_FAILURE
TAG=v1.2.3-rc1 check allow-absent '' fail
echo 'Release draft guard negative controls passed.'
