#!/usr/bin/env bash
# Fetch / stage ffmpeg + Ghostscript into src-tauri/binaries/ for Tauri externalBin.
# Blobs are gitignored. Run before `npm run build` / `tauri build`.
#
# Usage:
#   ./scripts/fetch-sidecars.sh              # current host (download when possible, else copy from PATH)
#   ./scripts/fetch-sidecars.sh --target <triple>
#   ./scripts/fetch-sidecars.sh --all        # best-effort known triples (download-only; skip if URL missing)
#   ./scripts/fetch-sidecars.sh --from-path  # force copy from PATH / common install locations
#
# Licenses: see THIRD_PARTY_NOTICES.md (ffmpeg LGPL preferred; Ghostscript AGPL — not sold).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

FROM_PATH=0
DO_ALL=0
TARGET_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-path) FROM_PATH=1; shift ;;
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
      sed -n '2,14p' "$0"
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
    echo "WARN: $bin links Homebrew dylibs — fine for same-machine CI/dev; for clean-machine macOS releases, replace with a static ffmpeg build under src-tauri/binaries/" >&2
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

ffmpeg_download_url() {
  local triple="$1"
  case "$triple" in
    x86_64-unknown-linux-gnu)
      echo "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
      ;;
    aarch64-unknown-linux-gnu)
      echo "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"
      ;;
    x86_64-pc-windows-msvc|x86_64-pc-windows-gnu)
      echo "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip"
      ;;
    *)
      return 1
      ;;
  esac
}

stage_ffmpeg_from_archive() {
  local url="$1" dest="$2"
  local work extract bin
  work="$(mktemp -d)"
  extract="$work/archive"
  mkdir -p "$extract"
  if ! download_file "$url" "$work/dl"; then
    rm -rf "$work"
    return 1
  fi
  case "$url" in
    *.tar.xz)
      tar -xJf "$work/dl" -C "$extract"
      bin="$(find "$extract" -type f -name ffmpeg | head -n1)"
      ;;
    *.zip)
      if ! command -v unzip >/dev/null 2>&1; then
        echo "ERROR: unzip required for $url" >&2
        rm -rf "$work"
        return 1
      fi
      unzip -q "$work/dl" -d "$extract"
      bin="$(find "$extract" -type f \( -name ffmpeg.exe -o -name ffmpeg \) | head -n1)"
      ;;
    *)
      echo "ERROR: unsupported archive type: $url" >&2
      rm -rf "$work"
      return 1
      ;;
  esac
  if [[ -z "${bin:-}" ]]; then
    echo "ERROR: ffmpeg not found in archive $url" >&2
    rm -rf "$work"
    return 1
  fi
  copy_tool "$bin" "$dest"
  rm -rf "$work"
}

stage_ffmpeg() {
  local triple="$1"
  local dest="$BIN_DIR/$(sidecar_name ffmpeg "$triple")"
  local src url

  if [[ "$FROM_PATH" -eq 1 ]]; then
    src="$(find_on_path ffmpeg || true)"
    if [[ -z "${src:-}" ]]; then
      echo "ERROR: ffmpeg not on PATH for --from-path" >&2
      return 1
    fi
    copy_tool "$src" "$dest"
    return 0
  fi

  if url="$(ffmpeg_download_url "$triple")"; then
    if stage_ffmpeg_from_archive "$url" "$dest"; then
      return 0
    fi
    echo "WARN: download failed for ffmpeg ($triple); trying PATH" >&2
  else
    echo "INFO: no pinned download URL for ffmpeg on $triple; using PATH if present" >&2
  fi

  src="$(find_on_path ffmpeg || true)"
  if [[ -n "${src:-}" ]]; then
    copy_tool "$src" "$dest"
    return 0
  fi
  echo "ERROR: could not stage ffmpeg for $triple" >&2
  return 1
}

stage_gs() {
  local triple="$1"
  local dest="$BIN_DIR/$(sidecar_name gs "$triple")"
  local src=""

  # Ghostscript is AGPL and rarely ships as a single static binary.
  # Copy a local install into the externalBin name (`gs`) so Tauri can bundle it.
  # Smoke-test the built app offline; if dylibs are missing on a target, use PATH drop-in.

  if is_windows_triple "$triple"; then
    src="$(find_on_path gswin64c || find_on_path gswin32c || find_on_path gs || true)"
  else
    src="$(find_on_path gs || find_on_path ghostscript || true)"
  fi

  if [[ -z "${src:-}" ]]; then
    if [[ "$DO_ALL" -eq 1 ]]; then
      local host
      host="$(host_triple)"
      if [[ "$triple" != "$host" ]]; then
        echo "SKIP: ghostscript not available to stage for foreign triple $triple" >&2
        return 0
      fi
    fi
    echo "ERROR: Ghostscript not found on PATH (install gs / gswin64c, then re-run)" >&2
    return 1
  fi
  copy_tool "$src" "$dest"
}

stage_for_triple() {
  local triple="$1"
  echo "=== staging sidecars for $triple ==="
  stage_ffmpeg "$triple"
  stage_gs "$triple"
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
