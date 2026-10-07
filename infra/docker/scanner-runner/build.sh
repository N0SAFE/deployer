#!/bin/bash
# =============================================================================
# Build the Scanner Runner Docker image
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="${SCANNER_RUNNER_IMAGE:-deployer-scanner-runner:latest}"

echo "==> Building scanner-runner image: ${IMAGE_NAME}"
echo "    Context: ${SCRIPT_DIR}"

docker build \
  -t "${IMAGE_NAME}" \
  -f "${SCRIPT_DIR}/Dockerfile" \
  "${SCRIPT_DIR}"

echo "==> Successfully built ${IMAGE_NAME}"
echo ""
echo "To push to a registry:"
echo "  docker tag ${IMAGE_NAME} registry.example.com/deployer/scanner-runner:latest"
echo "  docker push registry.example.com/deployer/scanner-runner:latest"
