#!/bin/bash
set -e
APP_BIN="/opt/Portiq/resources/bin"
if [ -x "$APP_BIN/portiq" ]; then
  ln -sf "$APP_BIN/portiq" /usr/bin/portiq
fi
if [ -x "$APP_BIN/portiq-mcp" ]; then
  ln -sf "$APP_BIN/portiq-mcp" /usr/bin/portiq-mcp
fi
exit 0
