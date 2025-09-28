#!/usr/bin/env node
/*
Migration script: migrate per-deployment nginx container content into project-level volumes
- Finds containers labeled deployer.nginx.static=true
- Copies /usr/share/nginx/html into project-<projectId>-static:/srv/static/<service>/<deploymentId>
- Removes stale Traefik dynamic YAMLs that reference old service/container identifiers

Usage: node scripts/migrate-static-to-project.js [--dry-run] [--remove-old]
*/

console.log('migrate-static-to-project.js: migration script removed by user request.');
process.exit(0);
