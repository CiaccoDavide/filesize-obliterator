#!/usr/bin/env bash
# Stage relocatable ffmpeg into src-tauri/binaries/ for Tauri externalBin.
# Blobs are gitignored. Run before `npm run build` / `tauri build` / cargo test.
#
# Usage:
#   ./scripts/fetch-sidecars.sh              # current host (prefer static download)
#   ./scripts/fetch-sidecars.sh --target <triple>
#   ./scripts/fetch-sidecars.sh --all        # best-effort known triples (download-only)
#   ./scripts/fetch-sidecars.sh --from-path  # copy ffmpeg from PATH (dev/CI fallback only)
#   ./scripts/fetch-sidecars.sh --stubs      # placeholder files so tauri-build/cargo test can run
#
# Ghostscript is NOT staged: AGPL redistribution is not permitted for this permissive
# product. PDF compress uses PATH / GS_PATH only — see THIRD_PARTY_NOTICES.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

FROM_PATH=0
DO_ALL=0
STUBS=0
TARGET_OVERRIDE=""

# Pinned single-file / static ffmpeg builds (relocatable offline OOTB).
# eugeneware/ffmpeg-static: gzipped single binaries (macOS + Windows + Linux).
# johnvansickle: fully static Linux tarballs (preferred when available).
FFMPEG_STATIC_TAG="b6.1.1"
FFMPEG_STATIC_BASE="https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_STATIC_TAG}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-path) FROM_PATH=1; shift ;;
    --stubs) STUBS=1; shift ;;
    --all) DO_ALL=1; shift ;;
    --target)
      TARGET_OVERRIDE="${2:-}"
      if [[ -z "$TARGET_OVERRIDE" ]]; then
        echo "ERROR: --target requires a Rust target triple" >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

host_triple() {
  rustc -vV | sed -n 's/^host: //p'
}

is_windows_triple() {
  case "$1" in
    *-windows-*|*-windows) return 0 ;;
    *) return 1 ;;
  esac
}

sidecar_name() {
  # $1=stem $2=triple
  local stem="$1" triple="$2"
  if is_windows_triple "$triple"; then
    echo "${stem}-${triple}.exe"
  else
    echo "${stem}-${triple}"
  fi
}

find_on_path() {
  local name="$1" p
  if command -v "$name" >/dev/null 2>&1; then
    p="$(command -v "$name")"
    if [[ -x "$p" && -f "$p" ]]; then
      echo "$p"
      return 0
    fi
  fi
  return 1
}

copy_tool() {
  local src="$1" dest="$2"
  # Dereference symlinks so we stage the real Mach-O / PE binary.
  if command -v realpath >/dev/null 2>&1; then
    src="$(realpath "$src")"
  elif command -v readlink >/dev/null 2>&1; then
    local resolved
    resolved="$(readlink "$src" || true)"
    if [[ -n "${resolved:-}" && -f "$resolved" ]]; then
      src="$resolved"
    elif [[ -n "${resolved:-}" && -f "$(dirname "$1")/$resolved" ]]; then
      src="$(cd "$(dirname "$1")" && realpath "$resolved" 2>/dev/null || echo "$(dirname "$1")/$resolved")"
    fi
  fi
  cp -f "$src" "$dest"
  chmod +x "$dest" 2>/dev/null || true
  echo "staged: $dest (from $src)"
  warn_if_homebrew_linked "$dest" || true
}

warn_if_homebrew_linked() {
  local bin="$1"
  if ! command -v otool >/dev/null 2>&1; then
    return 0
  fi
  if otool -L "$bin" 2>/dev/null | grep -q '/opt/homebrew\|/usr/local/Cellar'; then
    echo "WARN: $bin links Homebrew dylibs — not relocatable offline. Prefer the default download path (omit --from-path) for release builds." >&2
  fi
}

download_file() {
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    echo "ERROR: need curl or wget to download $url" >&2
    return 1
  fi
}

# Returns a URL + format hint via echo: "url|kind" where kind is tar.xz|zip|gz
ffmpeg_download_spec() {
  local triple="$1"
  case "$triple" in
    x86_64-unknown-linux-gnu)
      echo "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz|tar.xz"
      ;;
    aarch64-unknown-linux-gnu)
      echo "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz|tar.xz"
      ;;
    x86_64-pc-windows-msvc|x86_64-pc-windows-gnu)
      echo "${FFMPEG_STATIC_BASE}/ffmpeg-win32-x64.gz|gz"
      ;;
    aarch64-pc-windows-msvc|aarch64-pc-windows-gnu)
      # No widely used arm64 Windows static pin yet.
      return 1
      ;;
    x86_64-apple-darwin)
      echo "${FFMPEG_STATIC_BASE}/ffmpeg-darwin-x64.gz|gz"
      ;;
    aarch64-apple-darwin)
      echo "${FFMPEG_STATIC_BASE}/ffmpeg-darwin-arm64.gz|gz"
      ;;
    *)
      return 1
      ;;
  esac
}

stage_ffmpeg_from_archive() {
  local url="$1" kind="$2" dest="$3"
  local work extract bin
  work="$(mktemp -d)"
  extract="$work/archive"
  mkdir -p "$extract"
  if ! download_file "$url" "$work/dl"; then
    rm -rf "$work"
    return 1
  fi
  case "$kind" in
    tar.xz)
      tar -xJf "$work/dl" -C "$extract"
      bin="$(find "$extract" -type f -name ffmpeg | head -n1)"
      ;;
    zip)
      if ! command -v unzip >/dev/null 2>&1; then
        echo "ERROR: unzip required for $url" >&2
        rm -rf "$work"
        return 1
      fi
      unzip -q "$work/dl" -d "$extract"
      bin="$(find "$extract" -type f \( -name ffmpeg.exe -o -name ffmpeg \) | head -n1)"
      ;;
    gz)
      # Single-file gzip from eugeneware/ffmpeg-static
      if command -v gzip >/dev/null 2>&1; then
        gzip -dc "$work/dl" > "$work/ffmpeg.bin"
      else
        echo "ERROR: gzip required to decompress $url" >&2
        rm -rf "$work"
        return 1
      fi
      bin="$work/ffmpeg.bin"
      ;;
    *)
      echo "ERROR: unsupported archive kind: $kind" >&2
      rm -rf "$work"
      return 1
      ;;
  esac
  if [[ -z "${bin:-}" || ! -f "$bin" ]]; then
    echo "ERROR: ffmpeg not found in archive $url" >&2
    rm -rf "$work"
    return 1
  fi
  copy_tool "$bin" "$dest"
  rm -rf "$work"
}

stage_ffmpeg_stub() {
  local triple="$1"
  local dest="$BIN_DIR/$(sidecar_name ffmpeg "$triple")"
  # Placeholder satisfies tauri-build externalBin copy. Runtime resolve prefers a
  # working binary (version probe) and falls through to PATH when stubs are inert.
  if is_windows_triple "$triple"; then
    # Non-PE placeholder; probe fails so resolve uses PATH ffmpeg in tests.
    printf 'FO_FFMPEG_STUB' > "$dest"
  else
    printf '#!/bin/sh\necho "filesize-obliterator ffmpeg stub"\nexit 1\n' > "$dest"
    chmod +x "$dest" 2>/dev/null || true
  fi
  echo "staged stub: $dest"
}

stage_ffmpeg() {
  local triple="$1"
  local dest="$BIN_DIR/$(sidecar_name ffmpeg "$triple")"
  local src spec url kind

  if [[ "$STUBS" -eq 1 ]]; then
    stage_ffmpeg_stub "$triple"
    return 0
  fi

  if [[ "$FROM_PATH" -eq 1 ]]; then
    src="$(find_on_path ffmpeg || true)"
    if [[ -z "${src:-}" ]]; then
      echo "ERROR: ffmpeg not on PATH for --from-path" >&2
      return 1
    fi
    copy_tool "$src" "$dest"
    return 0
  fi

  if spec="$(ffmpeg_download_spec "$triple")"; then
    url="${spec%%|*}"
    kind="${spec##*|}"
    if stage_ffmpeg_from_archive "$url" "$kind" "$dest"; then
      return 0
    fi
    echo "WARN: download failed for ffmpeg ($triple); trying PATH" >&2
  else
    echo "INFO: no pinned static download URL for ffmpeg on $triple; using PATH if present" >&2
  fi

  src="$(find_on_path ffmpeg || true)"
  if [[ -n "${src:-}" ]]; then
    copy_tool "$src" "$dest"
    return 0
  fi
  echo "ERROR: could not stage ffmpeg for $triple" >&2
  return 1
}

note_ghostscript_path_only() {
  echo "INFO: Ghostscript is PATH-only (AGPL — not redistributed via externalBin). Install gs / gswin64c for PDF compress, or set GS_PATH." >&2
  # Remove any previously staged AGPL gs sidecars so they cannot be bundled by mistake.
  local leftover
  for leftover in "$BIN_DIR"/gs-* "$BIN_DIR"/gs; do
    if [[ -e "$leftover" ]]; then
      rm -f "$leftover"
      echo "removed leftover Ghostscript sidecar: $leftover" >&2
    fi
  done
}

stage_for_triple() {
  local triple="$1"
  echo "=== staging ffmpeg sidecar for $triple ==="
  stage_ffmpeg "$triple"
  note_ghostscript_path_only
}

if [[ "$DO_ALL" -eq 1 ]]; then
  HOST="$(host_triple)"
  for t in \
    "$HOST" \
    "x86_64-unknown-linux-gnu" \
    "aarch64-unknown-linux-gnu" \
    "x86_64-pc-windows-msvc" \
    "x86_64-apple-darwin" \
    "aarch64-apple-darwin"
  do
    [[ -z "$t" ]] && continue
    stage_for_triple "$t" || echo "WARN: incomplete staging for $t" >&2
  done
else
  TARGET="${TARGET_OVERRIDE:-$(host_triple)}"
  if [[ -z "$TARGET" ]]; then
    echo "ERROR: could not detect host triple (is rustc installed?)" >&2
    exit 1
  fi
  stage_for_triple "$TARGET"
fi

echo "Done. Binaries in $BIN_DIR:"
ls -la "$BIN_DIR" | sed -n '1,40p'
