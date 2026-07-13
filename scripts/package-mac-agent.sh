#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:?usage: package-mac-agent.sh <x64|arm64> <node-version>}"
NODE_VERSION="${2:?usage: package-mac-agent.sh <x64|arm64> <node-version>}"
NODE_ARCH="$ARCH"
OUT="$ROOT/release/CodexMeter-Agent-macOS-$ARCH"
ARCHIVE="$ROOT/release/CodexMeter-Agent-macOS-$ARCH.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$NODE_ARCH.tar.gz" -o "$TMP/node.tar.gz"
tar -xzf "$TMP/node.tar.gz" -C "$TMP"
rm -rf "$OUT" "$ARCHIVE"
mkdir -p "$OUT/Resources"
cp "$TMP/node-$NODE_VERSION-darwin-$NODE_ARCH/bin/node" "$OUT/Resources/node"
cp "$ROOT/agent/dist/agent.cjs" "$OUT/Resources/agent.cjs"
cp "$ROOT/agent/macos/"*.command "$OUT/"
cp "$ROOT/agent/macos/README.txt" "$OUT/"
chmod 700 "$OUT/Resources/node" "$OUT/"*.command
ditto -c -k --sequesterRsrc --keepParent "$OUT" "$ARCHIVE"
echo "Created $ARCHIVE"
