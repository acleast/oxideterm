#!/usr/bin/env bash
# Build OxideTerm for Linux.
#
# Default output:
#   src-tauri/target/release/oxideterm
#
# Usage:
#   ./scripts/build-linux.sh
#   ./scripts/build-linux.sh deb
#   ./scripts/build-linux.sh appimage
#   ./scripts/build-linux.sh rpm
#   OXIDETERM_CREATE_UPDATER_ARTIFACTS=1 ./scripts/build-linux.sh deb

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[build-linux]${NC} $*"; }
warn() { echo -e "${YELLOW}[build-linux]${NC} $*"; }
error() { echo -e "${RED}[build-linux]${NC} $*" >&2; }

print_usage() {
  cat <<'EOF'
Usage:
  ./scripts/build-linux.sh
  ./scripts/build-linux.sh [deb|appimage|rpm]
  pnpm build:linux

Defaults:
  Builds only the Linux release executable.

Examples:
  ./scripts/build-linux.sh
  ./scripts/build-linux.sh deb
  ./scripts/build-linux.sh appimage

Updater artifacts:
  By default this script disables updater artifacts for local Linux builds so a
  missing TAURI_SIGNING_PRIVATE_KEY does not fail the build after the executable
  and package are already generated.

  To build updater artifacts, provide signing env vars and run:
    OXIDETERM_CREATE_UPDATER_ARTIFACTS=1 ./scripts/build-linux.sh deb
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    error "Missing command: $command_name"
    return 1
  fi
}

check_pkg_config() {
  local package_name="$1"
  if ! pkg-config --exists "$package_name"; then
    error "Missing pkg-config package: $package_name"
    return 1
  fi
}

check_prerequisites() {
  local missing=0

  for command_name in node pnpm rustc cargo pkg-config patchelf; do
    require_command "$command_name" || missing=1
  done

  if [[ "${1:-deb}" == "deb" ]]; then
    for command_name in dpkg-deb fakeroot; do
      require_command "$command_name" || missing=1
    done
  fi

  for package_name in webkit2gtk-4.1 gtk+-3.0 ayatana-appindicator3-0.1 librsvg-2.0 openssl libudev; do
    check_pkg_config "$package_name" || missing=1
  done

  if [[ "$missing" -ne 0 ]]; then
    cat >&2 <<'EOF'

Install common Ubuntu build dependencies with:
  sudo apt update
  sudo apt install -y build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf libwebkit2gtk-4.1-dev libudev-dev dpkg-dev fakeroot
EOF
    exit 1
  fi
}

package_version() {
  node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.stdout.write(pkg.version);"
}

product_name() {
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')); process.stdout.write(cfg.productName || 'OxideTerm');"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

bundle_kind="none"
tauri_args=()

if [[ "$#" -eq 0 ]]; then
  tauri_args=(--no-bundle)
elif [[ "$1" == "deb" || "$1" == "appimage" || "$1" == "rpm" ]]; then
  bundle_kind="$1"
  tauri_args=(--bundles "$@")
elif [[ "$1" == "--no-bundle" ]]; then
  bundle_kind="none"
  tauri_args=(--no-bundle)
else
  tauri_args=("$@")
fi

check_prerequisites "$bundle_kind"

config_args=()
if [[ "${OXIDETERM_CREATE_UPDATER_ARTIFACTS:-0}" != "1" ]]; then
  config_args=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
  warn "Updater artifacts are disabled for this local Linux build."
fi

log "Running: pnpm tauri build --ci ${config_args[*]} ${tauri_args[*]}"
pnpm tauri build --ci "${config_args[@]}" "${tauri_args[@]}"

version="$(package_version)"
name="$(product_name)"

log "Linux executable:"
echo "  $ROOT_DIR/src-tauri/target/release/oxideterm"

case "$bundle_kind" in
  deb)
    log "Deb package:"
    echo "  $ROOT_DIR/src-tauri/target/release/bundle/deb/${name}_${version}_amd64.deb"
    ;;
  appimage)
    log "AppImage output directory:"
    echo "  $ROOT_DIR/src-tauri/target/release/bundle/appimage"
    ;;
  rpm)
    log "RPM output directory:"
    echo "  $ROOT_DIR/src-tauri/target/release/bundle/rpm"
    ;;
  none)
    log "Bundling skipped."
    ;;
esac
