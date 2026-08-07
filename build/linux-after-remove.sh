#!/bin/bash
# Remove our /usr/bin shims on uninstall, but only if they are actually ours
# (a symlink pointing into our Resources/bin) so we never delete a file that
# the user (or another app) placed there.
set -e
SHIM_PREFIX="/opt/Portiq/resources/bin/"

for name in portiq portiq-mcp; do
  path="/usr/bin/$name"
  if [ -L "$path" ]; then
    target=$(readlink "$path" 2>/dev/null) || target=""
    case "$target" in
      "${SHIM_PREFIX}"*)
        rm -f "$path"
        ;;
      *)
        echo "leaving $path (not a Portiq shim)" >&2
        ;;
    esac
  fi
done
exit 0
