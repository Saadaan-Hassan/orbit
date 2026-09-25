#!/bin/sh
# Version consistency check (DOC-006).
#
# The desktop app has one release version, sourced from
# app/src-tauri/tauri.conf.json (what actually drives the v* release tag,
# the .dmg filename, and the auto-updater). app/package.json and
# app/src-tauri/Cargo.toml/backend/pyproject.toml must match it, since the
# backend ships bundled inside the same app release as a PyInstaller
# sidecar.
#
# The Chrome extension has its own independent release lineage (separate
# ext-v* tags, its own Web Store listing — see AGENTS.md's "Chrome
# extension distribution" section) — extension/manifest.json is authoritative
# there, and extension/package.json must match it, but neither is expected
# to match the app's version.
#
# Usage: sh scripts/check-versions.sh   (run from repo root)

set -eu
cd "$(dirname "$0")/.."

fail=0

extract_json_version() {
  # $1 = file. Grabs the first top-level "version": "..." line.
  grep -m1 '"version"' "$1" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

extract_toml_version() {
  # $1 = file. Grabs the first version = "..." line.
  grep -m1 '^version[[:space:]]*=' "$1" | sed -E 's/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/'
}

app_version=$(extract_json_version app/src-tauri/tauri.conf.json)
echo "App release version (app/src-tauri/tauri.conf.json): $app_version"

check_matches() {
  # $1 = label, $2 = expected, $3 = actual
  if [ "$2" != "$3" ]; then
    echo "MISMATCH: $1 is $3, expected $2"
    fail=1
  else
    echo "OK: $1 matches ($3)"
  fi
}

check_matches "app/package.json" "$app_version" "$(extract_json_version app/package.json)"
check_matches "app/src-tauri/Cargo.toml" "$app_version" "$(extract_toml_version app/src-tauri/Cargo.toml)"
check_matches "backend/pyproject.toml" "$app_version" "$(extract_toml_version backend/pyproject.toml)"

ext_version=$(extract_json_version extension/manifest.json)
echo ""
echo "Extension release version (extension/manifest.json): $ext_version"
check_matches "extension/package.json" "$ext_version" "$(extract_json_version extension/package.json)"

echo ""
if [ "$fail" -ne 0 ]; then
  echo "Version consistency check FAILED."
  exit 1
fi
echo "Version consistency check passed."
