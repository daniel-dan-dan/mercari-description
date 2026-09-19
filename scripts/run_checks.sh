#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

for source_file in app.js review.js pair.js bootstrap.js public-config.js sw.js; do
  node --check "$source_file"
done

for test_file in tests/*.cjs; do
  node "$test_file"
done
