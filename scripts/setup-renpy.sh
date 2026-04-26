#!/usr/bin/env bash
# setup-renpy.sh
# Idempotent: ensure Ren'Py SDK is available at <repoRoot>/renpy-sdk/ on
# macOS / Linux. Mirror of scripts/setup-renpy.ps1 but for POSIX.
#
# Strategy:
#   1. Read .renpy-version for the target version (e.g. 8.3.4)
#   2. If <repoRoot>/renpy-<version>-sdk/ exists, just (re)create the symlink
#   3. Otherwise download renpy-<version>-sdk.tar.bz2 from renpy.org,
#      extract into <repoRoot>, then symlink renpy-sdk -> renpy-<version>-sdk
#
# Usage:
#   bash scripts/setup-renpy.sh          # idempotent
#   bash scripts/setup-renpy.sh --force  # force re-download

set -euo pipefail

FORCE=0
if [[ "${1:-}" == "--force" || "${1:-}" == "-f" ]]; then
    FORCE=1
fi

# repo root = parent of this script's dir (works whether launched from root or elsewhere).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$ROOT/.renpy-version"
LINK_PATH="$ROOT/renpy-sdk"

if [[ ! -f "$VERSION_FILE" ]]; then
    echo "[setup-renpy] not found: $VERSION_FILE — write a target version (e.g. 8.3.4) first" >&2
    exit 1
fi

VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
SDK_DIR="$ROOT/renpy-$VERSION-sdk"

echo "[setup-renpy] target version: $VERSION"
echo "[setup-renpy] SDK directory:  $SDK_DIR"

# ── 1. download / extract SDK ─────────────────────────────────────────
if [[ -d "$SDK_DIR" && $FORCE -eq 0 ]]; then
    echo "[setup-renpy] SDK already exists, skipping download. (pass --force to redownload)"
else
    if [[ $FORCE -eq 1 && -d "$SDK_DIR" ]]; then
        echo "[setup-renpy] --force: removing existing SDK..."
        rm -rf "$SDK_DIR"
    fi

    TARBALL_NAME="renpy-$VERSION-sdk.tar.bz2"
    TARBALL_PATH="${TMPDIR:-/tmp}/$TARBALL_NAME"
    URL="https://www.renpy.org/dl/$VERSION/$TARBALL_NAME"

    if [[ -f "$TARBALL_PATH" ]]; then
        echo "[setup-renpy] reusing cached tarball: $TARBALL_PATH"
    else
        echo "[setup-renpy] downloading $URL"
        if command -v curl >/dev/null 2>&1; then
            curl -fL --retry 3 -o "$TARBALL_PATH" "$URL"
        elif command -v wget >/dev/null 2>&1; then
            wget -O "$TARBALL_PATH" "$URL"
        else
            echo "[setup-renpy] need curl or wget; install one and retry" >&2
            exit 1
        fi
    fi

    echo "[setup-renpy] extracting into $ROOT ..."
    tar -xjf "$TARBALL_PATH" -C "$ROOT"

    if [[ ! -d "$SDK_DIR" ]]; then
        echo "[setup-renpy] extraction finished but $SDK_DIR not found — check tarball layout" >&2
        exit 1
    fi
fi

# ── 2. (re)create symlink renpy-sdk -> renpy-<version>-sdk ────────────
# -n makes ln treat an existing symlink as a file, not as a dir to descend into.
ln -sfn "$SDK_DIR" "$LINK_PATH"
echo "[setup-renpy] symlink: $LINK_PATH -> $SDK_DIR"

# ── 3. sanity check ───────────────────────────────────────────────────
RENPY_SH="$LINK_PATH/renpy.sh"
if [[ ! -f "$RENPY_SH" ]]; then
    echo "[setup-renpy] sanity check failed: $RENPY_SH not found" >&2
    exit 1
fi
chmod +x "$RENPY_SH" 2>/dev/null || true
# Inner lib/*/renpy binaries must also be executable.
find "$LINK_PATH/lib" -type f \( -name 'renpy' -o -name 'pythonw' -o -name 'python' \) \
    -exec chmod +x {} \; 2>/dev/null || true

echo ""
echo "[setup-renpy] OK. Ren'Py $VERSION ready:"
echo "  $RENPY_SH <game-path>"
