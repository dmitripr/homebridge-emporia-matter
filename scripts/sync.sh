#!/usr/bin/env bash
#
# Copy a local build into a Homebridge storage directory for manual testing.
#
# Usage:
#   ./scripts/sync.sh [homebridge-storage-path] [--no-build]
#
# The default storage path is ~/.homebridge. The plugin is copied to
# <storage>/node_modules/homebridge-emporia-matter, which is how Homebridge
# resolves installed plugins. Restart Homebridge after syncing.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORAGE_PATH="${HOME}/.homebridge"
BUILD=true

for argument in "$@"; do
  case "${argument}" in
    --no-build)
      BUILD=false
      ;;
    -*)
      echo "Unknown option: ${argument}" >&2
      exit 1
      ;;
    *)
      STORAGE_PATH="${argument}"
      ;;
  esac
done

TARGET="${STORAGE_PATH}/node_modules/homebridge-emporia-matter"

if [[ ! -d "${STORAGE_PATH}" ]]; then
  echo "Homebridge storage directory does not exist: ${STORAGE_PATH}" >&2
  echo "Pass the correct path, for example: ./scripts/sync.sh ~/.homebridge" >&2
  exit 1
fi

if [[ "${BUILD}" == true ]]; then
  echo "Building plugin..."
  (cd "${REPO_ROOT}" && npm run build)
fi

if [[ ! -f "${REPO_ROOT}/dist/index.js" ]]; then
  echo "dist/index.js is missing. Run npm run build first." >&2
  exit 1
fi

echo "Syncing to ${TARGET}"
mkdir -p "${TARGET}"
rsync -a --delete "${REPO_ROOT}/dist/" "${TARGET}/dist/"
for file in package.json config.schema.json README.md CHANGELOG.md LICENSE; do
  if [[ -f "${REPO_ROOT}/${file}" ]]; then
    cp "${REPO_ROOT}/${file}" "${TARGET}/${file}"
  fi
done

echo "Done. Restart Homebridge to load the updated plugin."
