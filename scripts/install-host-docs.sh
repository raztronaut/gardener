#!/usr/bin/env bash
# Install the machine's agent guidance, without touching app code or services.
set -euo pipefail

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../docs/host" && pwd)"
target_dir="${1:-/}"
target_dir="$(realpath -e -- "$target_dir")"
if [[ "$target_dir" == / && "$EUID" -ne 0 ]]; then
  echo 'Installing docs at / requires an administrator. Run this script with sudo.' >&2
  exit 1
fi

for name in AGENTS.md CLAUDE.md GARDENOS.md; do
  [[ -s "$source_dir/$name" ]] || { echo "Missing source: $name" >&2; exit 1; }
  [[ ! -d "$target_dir/$name" ]] || { echo "Refusing to replace directory: $name" >&2; exit 1; }
done

backup_dir="$target_dir/.gardenos-agent-docs-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
for name in AGENTS.md CLAUDE.md GARDENOS.md; do
  dest="$target_dir/$name"
  if [[ -f "$dest" && ! -L "$dest" ]] && cmp -s -- "$source_dir/$name" "$dest"; then
    echo "Already current: $dest"
    continue
  fi
  if [[ -e "$dest" || -L "$dest" ]]; then
    mkdir -p -- "$backup_dir"
    cp -a -- "$dest" "$backup_dir/$name"
  fi
  temp_file="$(mktemp "$target_dir/.gardenos-doc.XXXXXXXX")"
  trap 'rm -f -- "$temp_file"' EXIT
  install -m 0644 -- "$source_dir/$name" "$temp_file"
  mv -fT -- "$temp_file" "$dest"
  trap - EXIT
  echo "Installed: $dest"
done
