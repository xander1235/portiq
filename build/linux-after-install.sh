#!/bin/bash
# Create /usr/bin shims for the portiq launchers, guarded so we never
# overwrite a file that isn't one of our own symlinks.
set -e
APP_BIN="/opt/Portiq/resources/bin"
SHIM_PREFIX="/opt/Portiq/resources/bin/"

is_own_shim() {
  # true iff $1 is a symlink whose direct target lives under our Resources/bin.
  [ -L "$1" ] || return 1
  local target
  target=$(readlink "$1") || return 1
  case "$target" in
    "${SHIM_PREFIX}"*) return 0 ;;
    *) return 1 ;;
  esac
}

for name in portiq portiq-mcp; do
  if [ -x "$APP_BIN/$name" ]; then
    if is_own_shim "/usr/bin/$name"; then
      ln -sf "$APP_BIN/$name" "/usr/bin/$name"
    elif [ -e "/usr/bin/$name" ] || [ -L "/usr/bin/$name" ]; then
      echo "leaving /usr/bin/$name (not a Portiq shim; refusing to overwrite)" >&2
    else
      ln -sf "$APP_BIN/$name" "/usr/bin/$name"
    fi
  fi
done
exit 0
