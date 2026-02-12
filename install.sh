#!/usr/bin/env bash
set -euo pipefail

# Codebuff installer / upgrader
# Usage: curl -fsSL https://raw.githubusercontent.com/ozanturksever/codebuff/main/install.sh | bash

REPO="ozanturksever/codebuff"
BINARY="codebuff"
INSTALL_DIR="${CODEBUFF_INSTALL_DIR:-/usr/local/bin}"

# --- helpers ----------------------------------------------------------------

die() { echo "error: $*" >&2; exit 1; }

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux*)  PLATFORM="linux" ;;
    Darwin*) PLATFORM="darwin" ;;
    *)       die "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)  ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)             die "Unsupported architecture: $arch" ;;
  esac
}

get_latest_version() {
  local url="https://api.github.com/repos/${REPO}/releases/latest"
  VERSION="$(curl -fsSL "$url" | grep -o '"tag_name": *"[^"]*"' | head -1 | grep -o 'v[^"]*')"
  [ -n "$VERSION" ] || die "Could not determine latest release version"
}

get_current_version() {
  if command -v "$BINARY" >/dev/null 2>&1; then
    CURRENT_VERSION="$("$BINARY" --version 2>/dev/null | tail -1 || echo "")"
  else
    CURRENT_VERSION=""
  fi
}

# --- main -------------------------------------------------------------------

main() {
  echo "Codebuff installer"
  echo ""

  detect_platform
  get_latest_version
  get_current_version

  local version_num="${VERSION#v}"

  if [ -n "$CURRENT_VERSION" ] && [ "$CURRENT_VERSION" = "$version_num" ]; then
    echo "Already up to date: $BINARY $version_num"
    exit 0
  fi

  if [ -n "$CURRENT_VERSION" ]; then
    echo "Upgrading $BINARY $CURRENT_VERSION -> $version_num"
  else
    echo "Installing $BINARY $version_num"
  fi

  echo "Platform: ${PLATFORM}-${ARCH}"

  local filename="${BINARY}-${PLATFORM}-${ARCH}.tar.gz"
  local url="https://github.com/${REPO}/releases/download/${VERSION}/${filename}"
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir:-}"' EXIT

  echo "Downloading ${url}..."
  curl -fSL --progress-bar "$url" -o "${tmpdir}/${filename}"

  echo "Extracting..."
  tar -xzf "${tmpdir}/${filename}" -C "$tmpdir"

  # Install - try direct, fall back to sudo
  if [ -w "$INSTALL_DIR" ]; then
    mv -f "${tmpdir}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
  else
    echo "Need sudo to write to ${INSTALL_DIR}"
    sudo mv -f "${tmpdir}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
  fi
  chmod +x "${INSTALL_DIR}/${BINARY}"

  echo ""
  echo "Installed $BINARY $version_num to ${INSTALL_DIR}/${BINARY}"
  echo ""
  echo "Get started:"
  echo "  cd your-project"
  echo "  $BINARY"
}

main "$@"
