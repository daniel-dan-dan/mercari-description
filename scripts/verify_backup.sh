#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backup_dir=${1:-}
if [ -z "$backup_dir" ] || [ ! -d "$backup_dir" ]; then
  echo "使い方: scripts/verify_backup.sh backups/YYYYMMDD-HHMMSS" >&2
  exit 2
fi
case "$backup_dir" in
  /*) ;;
  *) backup_dir="$repo_root/$backup_dir" ;;
esac

for required in repository.bundle staged.patch working-tree.patch untracked-files.tar.gz SHA256SUMS; do
  if [ ! -f "$backup_dir/$required" ]; then
    echo "必要なファイルがありません: $required" >&2
    exit 3
  fi
done

(
  cd "$backup_dir"
  shasum -a 256 -c SHA256SUMS
)
git bundle verify "$backup_dir/repository.bundle"

verify_root=$(mktemp -d "${TMPDIR:-/tmp}/mercari-backup-verify.XXXXXX")
verify_parent=$(CDPATH= cd -- "$(dirname -- "$verify_root")" && pwd -P)
verify_root="$verify_parent/$(basename -- "$verify_root")"
cleanup() {
  case "$verify_root" in
    /tmp/mercari-backup-verify.*|/private/tmp/mercari-backup-verify.*|/var/folders/*/*/T/mercari-backup-verify.*|/private/var/folders/*/*/T/mercari-backup-verify.*)
      rm -rf -- "$verify_root"
      ;;
    *)
      echo "検証用フォルダを自動削除できませんでした: $verify_root" >&2
      ;;
  esac
}
trap cleanup EXIT HUP INT TERM

git clone --quiet "$backup_dir/repository.bundle" "$verify_root/repo"
cd "$verify_root/repo"

if [ -s "$backup_dir/staged.patch" ]; then
  git apply --check "$backup_dir/staged.patch"
  git apply "$backup_dir/staged.patch"
fi
if [ -s "$backup_dir/working-tree.patch" ]; then
  git apply --check "$backup_dir/working-tree.patch"
  git apply "$backup_dir/working-tree.patch"
fi

tar -tzf "$backup_dir/untracked-files.tar.gz" | while IFS= read -r archived_path; do
  case "$archived_path" in
    /*|../*|*/../*)
      echo "安全でないパスがバックアップに含まれています: $archived_path" >&2
      exit 4
      ;;
  esac
done
tar -xzf "$backup_dir/untracked-files.tar.gz" -C "$verify_root/repo"

scripts/run_checks.sh
echo "バックアップからの復元テストに成功しました"
