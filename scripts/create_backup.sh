#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
stamp=${1:-$(date '+%Y%m%d-%H%M%S')}
backup_dir="$repo_root/backups/$stamp"

case "$stamp" in
  ''|*[!A-Za-z0-9._-]*)
    echo "バックアップ名は英数字と . _ - だけにしてください" >&2
    exit 2
    ;;
esac

if [ -e "$backup_dir" ]; then
  echo "同じ名前のバックアップが既にあります: $backup_dir" >&2
  exit 3
fi

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

git -C "$repo_root" bundle create "$backup_dir/repository.bundle" --all
git -C "$repo_root" diff --binary --cached > "$backup_dir/staged.patch"
git -C "$repo_root" diff --binary > "$backup_dir/working-tree.patch"
git -C "$repo_root" status --porcelain=v1 > "$backup_dir/status.txt"
git -C "$repo_root" rev-parse HEAD > "$backup_dir/head.txt"

git -C "$repo_root" ls-files --others --exclude-standard -z \
  | tar --null -czf "$backup_dir/untracked-files.tar.gz" -C "$repo_root" -T -

(
  cd "$backup_dir"
  shasum -a 256 \
    repository.bundle staged.patch working-tree.patch status.txt head.txt untracked-files.tar.gz \
    > SHA256SUMS
)
chmod 600 "$backup_dir"/*

echo "$backup_dir"
