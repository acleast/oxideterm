#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/manual-serial-roundtrip.sh <serial-port> [loopback|responder]

Examples:
  scripts/manual-serial-roundtrip.sh /dev/cu.usbserial-0001 loopback
  scripts/manual-serial-roundtrip.sh /dev/ttyUSB0 loopback
  scripts/manual-serial-roundtrip.sh COM10 loopback

Modes:
  loopback   Expects the written bytes to be read back. Use this with TX/RX
             shorted on a USB-UART adapter or equivalent hardware loopback.
  responder  Expects an external peer to reply with oxideterm-serial-pong-*.
             Use this with a second serial endpoint or test responder.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

serial_port="${1:-${OXIDETERM_SERIAL_MANUAL_PORT:-}}"
serial_mode="${2:-${OXIDETERM_SERIAL_MANUAL_MODE:-loopback}}"

if [[ -z "$serial_port" ]]; then
  usage >&2
  exit 2
fi

case "$serial_mode" in
  loopback|responder) ;;
  *)
    echo "Unsupported mode: $serial_mode" >&2
    usage >&2
    exit 2
    ;;
esac

export OXIDETERM_SERIAL_MANUAL_PORT="$serial_port"
export OXIDETERM_SERIAL_MANUAL_MODE="$serial_mode"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
native_root="$(cd "$repo_root/../oxideterm" 2>/dev/null && pwd || true)"

echo "Serial manual port: $OXIDETERM_SERIAL_MANUAL_PORT"
echo "Serial manual mode: $OXIDETERM_SERIAL_MANUAL_MODE"

(
  cd "$repo_root"
  cargo test --manifest-path src-tauri/Cargo.toml \
    manual_serial_pseudo_device_round_trip_and_reopen \
    --lib -- --ignored --nocapture
)

if [[ -n "$native_root" && -f "$native_root/Cargo.toml" ]]; then
  (
    cd "$native_root"
    cargo test -p oxideterm-terminal \
      manual_serial_pseudo_device_round_trip_and_reopen \
      -- --ignored --nocapture
  )
else
  echo "Native repo ../oxideterm not found; skipped native manual check." >&2
fi
