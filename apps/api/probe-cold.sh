#!/bin/zsh
cd /home/sebille/Bureau/projects/tests/deployer/v3/apps/api
bun --bun probe-cold.ts "core/modules/mesh/mesh-core.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
bun --bun probe-cold.ts "modules/docker/docker.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
bun --bun probe-cold.ts "core/orchestrator/orchestrator.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
bun --bun probe-cold.ts "app.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
bun --bun probe-cold.ts "core/modules/database/database.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
bun --bun probe-cold.ts "modules/deployment/deployment.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
bun --bun probe-cold.ts "modules/providers/providers.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
bun --bun probe-cold.ts "core/modules/setup/initialization.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
bun --bun probe-cold.ts "core/modules/swarm/swarm-inventory.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
bun --bun probe-cold.ts "core/modules/supervisors/platform/platform-supervisors.module.ts" 2>/dev/null | grep -E "^(OK|FAIL)"
