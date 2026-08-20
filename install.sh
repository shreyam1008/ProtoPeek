#!/bin/sh

set -eu

APP_NAME="ProtoPeek"
REPO="${PROTOPEEK_REPO:-shreyam1008/ProtoPeek}"
INSTALL_DIR="${PROTOPEEK_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
MAN_DIR="${PROTOPEEK_MAN_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/man/man1}"
DOWNLOAD_URL="${PROTOPEEK_DOWNLOAD_URL:-}"
CHECKSUM_URL="${PROTOPEEK_CHECKSUM_URL:-}"
CHANNEL="${PROTOPEEK_CHANNEL:-stable}"
VERSION="${PROTOPEEK_VERSION:-}"
API_ROOT="${PROTOPEEK_API_ROOT:-https://api.github.com/repos/$REPO}"
DOWNLOAD_BASE_URL="${PROTOPEEK_DOWNLOAD_BASE_URL:-https://github.com/$REPO/releases/download}"
EDGE_TAG="v0.0.0-edge"

supports_color() {
  [ -t 1 ] && [ "${TERM:-}" != "dumb" ]
}

if supports_color; then
  C_RESET="$(printf '\033[0m')"
  C_BRAND="$(printf '\033[38;5;43m')"
  C_ACCENT="$(printf '\033[38;5;214m')"
  C_MUTED="$(printf '\033[38;5;245m')"
  C_GOOD="$(printf '\033[38;5;78m')"
  C_BAD="$(printf '\033[38;5;203m')"
  C_BOLD="$(printf '\033[1m')"
else
  C_RESET=""
  C_BRAND=""
  C_ACCENT=""
  C_MUTED=""
  C_GOOD=""
  C_BAD=""
  C_BOLD=""
fi

say() {
  printf '%s\n' "$*"
}

step() {
  say "${C_BRAND}${C_BOLD}==>${C_RESET} $*"
}

info() {
  say "${C_MUTED}$*${C_RESET}"
}

warn() {
  say "${C_ACCENT}${C_BOLD}warning:${C_RESET} $*" >&2
}

success() {
  say "${C_GOOD}${C_BOLD}Installed${C_RESET} $*"
}

fail() {
  say "${C_BAD}${C_BOLD}error:${C_RESET} $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

http_get() {
  url="$1"
  if need_cmd curl; then
    curl -fsSL "$url"
    return
  fi
  if need_cmd wget; then
    wget -qO- "$url"
    return
  fi
  fail "Neither curl nor wget is available."
}

download_to() {
  url="$1"
  output="$2"
  if need_cmd curl; then
    curl -fsSL "$url" -o "$output"
    return
  fi
  if need_cmd wget; then
    wget -qO "$output" "$url"
    return
  fi
  fail "Neither curl nor wget is available."
}

valid_tag() {
  printf '%s\n' "$1" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
}

resolve_tag() {
  if [ -n "$VERSION" ]; then
    valid_tag "$VERSION" || fail "PROTOPEEK_VERSION must be a tag such as v0.2.0."
    say "$VERSION"
    return
  fi

  case "$CHANNEL" in
    edge)
      say "$EDGE_TAG"
      return
      ;;
    stable)
      ;;
    *)
      fail "PROTOPEEK_CHANNEL must be 'stable' or 'edge'."
      ;;
  esac

  latest_json="$(http_get "$API_ROOT/releases/latest")" || fail "Could not resolve the latest stable release."
  latest_tag="$(printf '%s\n' "$latest_json" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$latest_tag" ] || fail "The release API did not return a stable tag."
  valid_tag "$latest_tag" || fail "The release API returned an invalid stable tag."
  say "$latest_tag"
}

detect_os() {
  case "$(uname -s)" in
    Linux)
      say "linux"
      ;;
    Darwin)
      say "osx"
      ;;
    *)
      fail "Unsupported operating system: $(uname -s)"
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)
      say "x86_64"
      ;;
    i386|i686)
      say "x86_32"
      ;;
    arm64|aarch64)
      say "arm64"
      ;;
    *)
      fail "Unsupported architecture: $(uname -m)"
      ;;
  esac
}

make_tmpdir() {
  mktemp -d 2>/dev/null || mktemp -d -t protopeek-install
}

sha256_file() {
  file="$1"
  if need_cmd sha256sum; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi
  if need_cmd shasum; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi
  fail "Neither sha256sum nor shasum is available for checksum verification."
}

verify_checksum() {
  archive="$1"
  archive_name="$2"
  checksums="$3"
  expected_lines="$(awk -v name="$archive_name" '$2 == name || $2 == "*" name { print $1 }' "$checksums")"
  expected_count="$(printf '%s\n' "$expected_lines" | sed '/^$/d' | wc -l | tr -d ' ')"
  [ "$expected_count" = "1" ] || fail "checksums.txt must contain exactly one entry for $archive_name."
  expected="$(printf '%s' "$expected_lines" | tr 'A-F' 'a-f')"
  [ "${#expected}" -eq 64 ] || fail "The checksum entry for $archive_name is not SHA-256."
  case "$expected" in
    *[!0-9a-f]*) fail "The checksum entry for $archive_name is malformed." ;;
  esac
  actual="$(sha256_file "$archive" | tr 'A-F' 'a-f')"
  [ "$actual" = "$expected" ] || fail "Checksum verification failed for $archive_name."
}

can_replace_pp() {
  [ ! -e "$INSTALL_DIR/pp" ] && [ ! -L "$INSTALL_DIR/pp" ] && return 0
  if [ -L "$INSTALL_DIR/pp" ]; then
    pp_target="$(readlink "$INSTALL_DIR/pp" 2>/dev/null || true)"
    [ "$pp_target" = "protopeek" ] && return 0
    [ "$pp_target" = "$INSTALL_DIR/protopeek" ] && return 0
  fi
  if [ -f "$INSTALL_DIR/pp" ] && [ -f "$INSTALL_DIR/.protopeek-install" ]; then
    marker_hash="$(awk '$1 == "ProtoPeek" && NF == 2 { print $2 }' "$INSTALL_DIR/.protopeek-install")"
    if [ -n "$marker_hash" ] && [ "$(sha256_file "$INSTALL_DIR/pp" | tr 'A-F' 'a-f')" = "$marker_hash" ]; then
      return 0
    fi
  fi
  [ -f "$INSTALL_DIR/pp" ] && [ -f "$INSTALL_DIR/protopeek" ] && cmp -s "$INSTALL_DIR/pp" "$INSTALL_DIR/protopeek"
}

print_banner() {
  say "${C_BRAND}${C_BOLD}ProtoPeek installer${C_RESET}"
  say "${C_MUTED}Local gRPC and HTTP workbench by Shreyam Adhikari${C_RESET}"
  say ""
}

main() {
  print_banner

  os="$(detect_os)"
  arch="$(detect_arch)"

  if [ -n "$DOWNLOAD_URL" ]; then
    archive_url="$DOWNLOAD_URL"
    archive_name="${archive_url##*/}"
    resolved_tag="${VERSION:-manual}"
  else
    resolved_tag="$(resolve_tag)"
    version_name="${resolved_tag#v}"
    archive_name="protopeek_${version_name}_${os}_${arch}.tar.gz"
    archive_url="$DOWNLOAD_BASE_URL/$resolved_tag/$archive_name"
  fi
  [ -n "$archive_name" ] || fail "Could not determine the archive filename."
  checksum_url="${CHECKSUM_URL:-${archive_url%/*}/checksums.txt}"

  tmpdir="$(make_tmpdir)"
  archive_path="$tmpdir/$archive_name"
  checksums_path="$tmpdir/checksums.txt"
  unpack_dir="$tmpdir/unpack"
  mkdir -p "$unpack_dir"
  trap 'rm -rf "$tmpdir"' EXIT INT TERM

  step "Downloading $APP_NAME"
  info "Source: $archive_url"
  download_to "$archive_url" "$archive_path" || fail "Could not download $archive_name."

  step "Verifying SHA-256 checksum"
  info "Checksums: $checksum_url"
  download_to "$checksum_url" "$checksums_path" || fail "Could not download checksums.txt."
  verify_checksum "$archive_path" "$archive_name" "$checksums_path"

  step "Extracting archive"
  tar -xzf "$archive_path" -C "$unpack_dir"
  [ -f "$unpack_dir/protopeek" ] || fail "The archive did not contain protopeek."
  if [ ! -f "$unpack_dir/pp" ]; then
    info "Legacy archive detected; deriving pp from the verified protopeek binary."
    cp "$unpack_dir/protopeek" "$unpack_dir/pp"
  fi
  chmod +x "$unpack_dir/protopeek" "$unpack_dir/pp"
  "$unpack_dir/protopeek" -version >/dev/null 2>&1 || fail "The protopeek binary check failed."
  "$unpack_dir/pp" -version >/dev/null 2>&1 || fail "The pp binary check failed."

  step "Installing binaries"
  mkdir -p "$INSTALL_DIR"
  info "Install target: $INSTALL_DIR"
  install_pp=true
  if ! can_replace_pp; then
    install_pp=false
    warn "$INSTALL_DIR/pp is not a recognized ProtoPeek alias; leaving it unchanged."
  fi

  protopeek_tmp="$INSTALL_DIR/.protopeek.$$.new"
  pp_tmp="$INSTALL_DIR/.pp.$$.new"
  cp "$unpack_dir/protopeek" "$protopeek_tmp"
  chmod +x "$protopeek_tmp"
  if [ "$install_pp" = true ]; then
    cp "$unpack_dir/pp" "$pp_tmp"
    chmod +x "$pp_tmp"
  fi
  mv -f "$protopeek_tmp" "$INSTALL_DIR/protopeek"
  if [ "$install_pp" = true ]; then
    mv -f "$pp_tmp" "$INSTALL_DIR/pp"
    pp_hash="$(sha256_file "$INSTALL_DIR/pp" | tr 'A-F' 'a-f')"
    printf 'ProtoPeek %s\n' "$pp_hash" > "$INSTALL_DIR/.protopeek-install"
  fi

  if [ -f "$unpack_dir/man/protopeek.1" ] && [ -f "$unpack_dir/man/pp.1" ]; then
    mkdir -p "$MAN_DIR"
    cp "$unpack_dir/man/protopeek.1" "$MAN_DIR/protopeek.1"
    cp "$unpack_dir/man/pp.1" "$MAN_DIR/pp.1"
  fi

  success "protopeek -> $INSTALL_DIR/protopeek"
  if [ "$install_pp" = true ]; then
    success "pp        -> $INSTALL_DIR/pp"
  fi

  case ":${PATH:-}:" in
    *:"$INSTALL_DIR":*)
      say ""
      if [ "$install_pp" = true ]; then
        say "${C_GOOD}${C_BOLD}Ready.${C_RESET} Run ${C_ACCENT}protopeek${C_RESET} or ${C_ACCENT}pp${C_RESET}."
      else
        say "${C_GOOD}${C_BOLD}Ready.${C_RESET} Run ${C_ACCENT}protopeek${C_RESET}."
      fi
      ;;
    *)
      say ""
      say "${C_ACCENT}${C_BOLD}One more step:${C_RESET} add ${INSTALL_DIR} to your PATH."
      say "  export PATH=\"$INSTALL_DIR:\$PATH\""
      ;;
  esac

  say ""
  info "Resolved release: $resolved_tag"
}

main "$@"
