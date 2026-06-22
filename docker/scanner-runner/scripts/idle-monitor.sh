#!/bin/bash
# =============================================================================
# Idle Monitor
# Called every minute by cron. Checks the last-activity timestamp and stops the
# container if it has been idle for longer than SCANNER_IDLE_TIMEOUT_SECONDS.
#
# This is the container-level safety net. If the app fails to stop the container
# after 10 minutes of inactivity, the container self-destructs after 2 hours.
# =============================================================================
set -euo pipefail

ACTIVITY_FILE="/var/run/scanner/last-activity"
TIMEOUT="${SCANNER_IDLE_TIMEOUT_SECONDS:-7200}"

if [ ! -f "$ACTIVITY_FILE" ]; then
    echo "[idle-monitor] No activity file found, creating one now"
    date +%s > "$ACTIVITY_FILE"
    exit 0
fi

LAST_ACTIVITY="$(cat "$ACTIVITY_FILE")"
NOW="$(date +%s)"
IDLE_SECONDS="$((NOW - LAST_ACTIVITY))"

if [ "$IDLE_SECONDS" -ge "$TIMEOUT" ]; then
    IDLE_MINUTES="$((IDLE_SECONDS / 60))"
    echo "[idle-monitor] Container idle for ${IDLE_MINUTES}m (timeout: ${TIMEOUT}s) — stopping self"
    
    # Kill PID 1 (the entrypoint). Docker will auto-remove the container.
    kill 1
    exit 0
fi

# Log a heartbeat line every 30 minutes for debugging
if [ "$((IDLE_SECONDS % 1800))" -lt 60 ]; then
    IDLE_MINUTES="$((IDLE_SECONDS / 60))"
    echo "[idle-monitor] Container idle for ${IDLE_MINUTES}m (timeout: ${TIMEOUT}s) — staying alive"
fi
