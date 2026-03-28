#!/bin/sh

set -eu

RAW_URL="https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$RAW_URL" | sh
  exit 0
fi

if command -v wget >/dev/null 2>&1; then
  wget -qO- "$RAW_URL" | sh
  exit 0
fi

echo "error: neither curl nor wget is installed." >&2
exit 1
