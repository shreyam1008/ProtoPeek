#!/usr/bin/env bash
set -euo pipefail
fixture="$(mktemp -d)"
payload="$fixture/payload"
install_dir="$fixture/install"
man_dir="$fixture/man"
archive="$fixture/protopeek_test_native_x86_64.tar.gz"
mkdir -p "$payload/man"
go build -ldflags '-X main.version=vtest' -o "$payload/protopeek" ./cmd/protopeek
go build -ldflags '-X main.version=vtest' -o "$payload/pp" ./cmd/pp
cp web/site/public/man/protopeek.1 web/site/public/man/pp.1 "$payload/man/"
tar -C "$payload" -czf "$archive" protopeek pp man
if command -v sha256sum >/dev/null 2>&1; then
  hash="$(sha256sum "$archive" | awk '{print $1}')"
else
  hash="$(shasum -a 256 "$archive" | awk '{print $1}')"
fi
printf '%s  %s\n' "$hash" "$(basename "$archive")" > "$fixture/checksums.txt"

PROTOPEEK_DOWNLOAD_URL="file://$archive" \
PROTOPEEK_CHECKSUM_URL="file://$fixture/checksums.txt" \
PROTOPEEK_INSTALL_DIR="$install_dir" \
PROTOPEEK_MAN_DIR="$man_dir" \
sh ./install.sh
"$install_dir/protopeek" -version
"$install_dir/pp" -version
test -f "$man_dir/protopeek.1"
test -f "$man_dir/pp.1"

# Resolve the rolling channel from a local release-shaped fixture, without
# using an explicit download URL or consulting the stable GitHub endpoint.
nightly_os="$(uname -s | tr '[:upper:]' '[:lower:]')"
[ "$nightly_os" != darwin ] || nightly_os=osx
case "$(uname -m)" in arm64|aarch64) nightly_arch=arm64 ;; *) nightly_arch=x86_64 ;; esac
nightly_name="protopeek_0.0.0-nightly_${nightly_os}_${nightly_arch}.tar.gz"
mkdir -p "$fixture/releases/v0.0.0-nightly"
cp "$archive" "$fixture/releases/v0.0.0-nightly/$nightly_name"
printf '%s  %s\n' "$hash" "$nightly_name" > "$fixture/releases/v0.0.0-nightly/checksums.txt"
PROTOPEEK_CHANNEL=nightly \
PROTOPEEK_DOWNLOAD_BASE_URL="file://$fixture/releases" \
PROTOPEEK_INSTALL_DIR="$fixture/nightly-install" \
PROTOPEEK_MAN_DIR="$man_dir" \
sh ./install.sh
"$fixture/nightly-install/protopeek" -version
"$fixture/nightly-install/pp" -version

printf 'replaced after install\n' > "$fixture/replaced-pp"
chmod +x "$fixture/replaced-pp"
mv -f "$fixture/replaced-pp" "$install_dir/pp"
PROTOPEEK_DOWNLOAD_URL="file://$archive" \
PROTOPEEK_CHECKSUM_URL="file://$fixture/checksums.txt" \
PROTOPEEK_INSTALL_DIR="$install_dir" \
PROTOPEEK_MAN_DIR="$man_dir" \
sh ./install.sh
grep -Fxq 'replaced after install' "$install_dir/pp"

legacy="$fixture/protopeek_legacy_native_x86_64.tar.gz"
tar -C "$payload" -czf "$legacy" protopeek
if command -v sha256sum >/dev/null 2>&1; then
  legacy_hash="$(sha256sum "$legacy" | awk '{print $1}')"
else
  legacy_hash="$(shasum -a 256 "$legacy" | awk '{print $1}')"
fi
printf '%s  %s\n' "$legacy_hash" "$(basename "$legacy")" > "$fixture/legacy-checksums.txt"
PROTOPEEK_DOWNLOAD_URL="file://$legacy" \
PROTOPEEK_CHECKSUM_URL="file://$fixture/legacy-checksums.txt" \
PROTOPEEK_INSTALL_DIR="$fixture/legacy-install" \
PROTOPEEK_MAN_DIR="$man_dir" \
sh ./install.sh
"$fixture/legacy-install/protopeek" -version
"$fixture/legacy-install/pp" -version

conflict_dir="$fixture/conflict"
mkdir -p "$conflict_dir"
printf 'unrelated pp\n' > "$conflict_dir/pp"
chmod +x "$conflict_dir/pp"
PROTOPEEK_DOWNLOAD_URL="file://$archive" \
PROTOPEEK_CHECKSUM_URL="file://$fixture/checksums.txt" \
PROTOPEEK_INSTALL_DIR="$conflict_dir" \
PROTOPEEK_MAN_DIR="$man_dir" \
sh ./install.sh
grep -Fxq 'unrelated pp' "$conflict_dir/pp"
"$conflict_dir/protopeek" -version

corrupt="$fixture/protopeek_corrupt_native_x86_64.tar.gz"
cp "$archive" "$corrupt"
printf 'corrupt' >> "$corrupt"
sed "s#$(basename "$archive")#$(basename "$corrupt")#" "$fixture/checksums.txt" > "$fixture/corrupt-checksums.txt"
if PROTOPEEK_DOWNLOAD_URL="file://$corrupt" \
  PROTOPEEK_CHECKSUM_URL="file://$fixture/corrupt-checksums.txt" \
  PROTOPEEK_INSTALL_DIR="$fixture/corrupt-install" \
  sh ./install.sh; then
  echo 'Corrupt archive unexpectedly installed.' >&2
  exit 1
fi

if PROTOPEEK_DOWNLOAD_URL="file://$archive" \
  PROTOPEEK_CHECKSUM_URL="file://$fixture/missing-checksums.txt" \
  PROTOPEEK_INSTALL_DIR="$fixture/missing-install" \
  sh ./install.sh; then
  echo 'Archive without checksums unexpectedly installed.' >&2
  exit 1
fi
