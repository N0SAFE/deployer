#!/bin/bash
# =============================================================================
# Scanner Runner Entrypoint
#
# Starts the cron daemon for idle checking, records the initial activity
# timestamp, then sleeps indefinitely to keep the container alive.
#
# The container uses Docker AutoRemove. When the idle-monitor determines the
# container has been inactive too long, it kills PID 1 (this script), causing
# Docker to automatically remove the container.
# =============================================================================
set -euo pipefail

# Record initial activity timestamp
date +%s > /var/run/scanner/last-activity

# Start cron daemon for periodic idle checks
cron

# Keep the container alive — tail blocks forever
exec tail -f /dev/null
