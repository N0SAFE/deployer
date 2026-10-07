#!/bin/bash
# =============================================================================
# Scanner Wrapper
# Logs the current timestamp to the activity file, then execs the real scanner.
#
# This script replaces the original scanner binary paths (/usr/local/bin/trivy,
# /usr/local/bin/grype, /usr/local/bin/dive). When the app runs:
#   docker exec <container> trivy image ...
# it hits this wrapper, which:
#   1. Records the current timestamp in /var/run/scanner/last-activity
#   2. Execs the real scanner binary (trivy.real, grype.real, dive.real)
#
# The idle-monitor cron job reads this timestamp to decide when to stop the
# container after prolonged inactivity.
# =============================================================================
set -euo pipefail

# Determine the real binary path by appending ".real" to our own path
SELF="$(basename "$0")"
REAL_BIN="/usr/local/bin/${SELF}.real"

if [ ! -x "$REAL_BIN" ]; then
    echo "FATAL: Real scanner binary not found: $REAL_BIN" >&2
    exit 1
fi

# Log activity timestamp (seconds since epoch)
date +%s > /var/run/scanner/last-activity

# Exec the real scanner with all original arguments
exec "$REAL_BIN" "$@"
