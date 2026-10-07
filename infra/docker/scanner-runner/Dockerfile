# =============================================================================
# Scanner Runner Image
# Shared container hosting Trivy, Grype, and Dive for container image scanning.
# The container self-manages its lifecycle: after 2 hours of inactivity it
# stops itself so Docker AutoRemove can clean it up.
# =============================================================================

FROM ubuntu:24.04 AS base

LABEL org.opencontainers.image.title="Deployer Scanner Runner"
LABEL org.opencontainers.image.description="Shared scanner container for Trivy, Grype, and Dive"
LABEL org.opencontainers.image.source="https://github.com/N0SAFE/deployer"

# Prevent tzdata interactive prompt
ENV DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# Install system dependencies
# ---------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    cron \
    jq \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Install Trivy
# ---------------------------------------------------------------------------
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
    | sh -s -- -b /usr/local/bin v0.69.3 \
    && trivy --version

# ---------------------------------------------------------------------------
# Install Grype
# ---------------------------------------------------------------------------
RUN curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh \
    | sh -s -- -b /usr/local/bin \
    && grype --version

# ---------------------------------------------------------------------------
# Install Dive
# Pinned release tarball: upstream removed its install.sh from the repo, so
# the old `curl | sh -s -- -b …` pattern now 404s and silently installed
# nothing (`|| true` swallowed it) — which later broke the binary-rename step.
# ---------------------------------------------------------------------------
ARG DIVE_VERSION=0.13.1
RUN curl -sSfL "https://github.com/wagoodman/dive/releases/download/v${DIVE_VERSION}/dive_${DIVE_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin dive \
    && dive --version

# ---------------------------------------------------------------------------
# Rename real scanner binaries and install timestamp-logging wrappers
# ---------------------------------------------------------------------------
RUN mv /usr/local/bin/trivy /usr/local/bin/trivy.real
RUN mv /usr/local/bin/grype /usr/local/bin/grype.real
RUN mv /usr/local/bin/dive  /usr/local/bin/dive.real

COPY scripts/scanner-wrapper.sh /usr/local/bin/trivy
COPY scripts/scanner-wrapper.sh /usr/local/bin/grype
COPY scripts/scanner-wrapper.sh /usr/local/bin/dive
RUN chmod +x /usr/local/bin/trivy /usr/local/bin/grype /usr/local/bin/dive

# ---------------------------------------------------------------------------
# Install entrypoint and idle monitor
# ---------------------------------------------------------------------------
COPY scripts/scanner-entrypoint.sh /usr/local/bin/scanner-entrypoint
COPY scripts/idle-monitor.sh    /usr/local/bin/idle-monitor
RUN chmod +x /usr/local/bin/scanner-entrypoint /usr/local/bin/idle-monitor

# ---------------------------------------------------------------------------
# Create activity tracking file and set up cron for idle checking
# ---------------------------------------------------------------------------
RUN mkdir -p /var/run/scanner /var/log/scanner
RUN touch /var/run/scanner/last-activity /var/log/scanner/idle-cron.log

# Cron job: check every minute if container has been idle too long
RUN echo "* * * * * /usr/local/bin/idle-monitor >> /var/log/scanner/idle-cron.log 2>&1" \
    | crontab -

# ---------------------------------------------------------------------------
# Container metadata
# ---------------------------------------------------------------------------
ENV SCANNER_IDLE_TIMEOUT_SECONDS=7200
ENV DOCKER_HOST=unix:///var/run/docker.sock

ENTRYPOINT ["/usr/local/bin/scanner-entrypoint"]
