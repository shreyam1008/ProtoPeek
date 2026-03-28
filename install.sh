#!/bin/sh

set -eu

APP_NAME="ProtoPeek"
REPO="${PROTOPEEK_REPO:-shreyam1008/ProtoPeek}"
INSTALL_DIR="${PROTOPEEK_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
DOWNLOAD_URL="${PROTOPEEK_DOWNLOAD_URL:-}"
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

resolve_tag() {
  if [ -n "$VERSION" ]; then
    say "$VERSION"
    return
  fi

  if [ "$CHANNEL" = "edge" ]; then
    say "$EDGE_TAG"
    return
  fi

  latest_json="$(http_get "$API_ROOT/releases/latest" 2>/dev/null || true)"
  latest_tag="$(printf '%s\n' "$latest_json" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"

  if [ -n "$latest_tag" ]; then
    say "$latest_tag"
    return
  fi

  info "No stable release was found yet. Falling back to the edge channel."
  say "$EDGE_TAG"
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

print_banner() {
  say "${C_BRAND}${C_BOLD}ProtoPeek installer${C_RESET}"
  say "${C_MUTED}Launcher-first gRPC workbench by Shreyam Adhikari${C_RESET}"
  say ""
}

main() {
  print_banner

  os="$(detect_os)"
  arch="$(detect_arch)"

  if [ -n "$DOWNLOAD_URL" ]; then
    archive_url="$DOWNLOAD_URL"
    resolved_tag="${VERSION:-manual}"
    version_name="${resolved_tag#v}"
  else
    resolved_tag="$(resolve_tag)"
    version_name="${resolved_tag#v}"
    archive_name="protopeek_${version_name}_${os}_${arch}.tar.gz"
    archive_url="$DOWNLOAD_BASE_URL/$resolved_tag/$archive_name"
  fi

  step "Preparing install directory"
  mkdir -p "$INSTALL_DIR"
  info "Install target: $INSTALL_DIR"

  tmpdir="$(make_tmpdir)"
  archive_path="$tmpdir/protopeek.tar.gz"
  unpack_dir="$tmpdir/unpack"
  mkdir -p "$unpack_dir"
  trap 'rm -rf "$tmpdir"' EXIT INT TERM

  step "Downloading $APP_NAME"
  info "Source: $archive_url"
  download_to "$archive_url" "$archive_path"

  step "Extracting archive"
  tar -xzf "$archive_path" -C "$unpack_dir"

  binary_path="$(find "$unpack_dir" -type f -name protopeek | head -n 1)"
  [ -n "$binary_path" ] || fail "The downloaded archive did not contain a protopeek binary."

  step "Installing binaries"
  cp "$binary_path" "$INSTALL_DIR/protopeek"
  chmod +x "$INSTALL_DIR/protopeek"
  if ln -sf protopeek "$INSTALL_DIR/pp" 2>/dev/null; then
    :
  else
    cp "$INSTALL_DIR/protopeek" "$INSTALL_DIR/pp"
  fi
  chmod +x "$INSTALL_DIR/pp"

  success "protopeek -> $INSTALL_DIR/protopeek"
  success "pp        -> $INSTALL_DIR/pp"

  if "$INSTALL_DIR/protopeek" -version >/dev/null 2>&1; then
    info "Binary check: protopeek -version succeeded."
  fi

  case ":${PATH:-}:" in
    *:"$INSTALL_DIR":*)
      say ""
      say "${C_GOOD}${C_BOLD}Ready.${C_RESET} Run ${C_ACCENT}protopeek${C_RESET} or ${C_ACCENT}pp${C_RESET}."
      ;;
    *)
      say ""
      say "${C_ACCENT}${C_BOLD}One more step:${C_RESET} add ${INSTALL_DIR} to your PATH."
      say "Example:"
      say "  export PATH=\"$INSTALL_DIR:\$PATH\""
      ;;
  esac

  say ""
  info "Resolved release: $resolved_tag"
}

main "$@"
