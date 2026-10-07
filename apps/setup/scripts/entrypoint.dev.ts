#!/usr/bin/env -S bun
/**
 * Start the setup app's dev processes.
 *
 * Setup needs TWO processes, exactly as the API does
 * (`apps/api/scripts/entrypoint.dev.ts` spawns `dev:vite` then starts Nest):
 *
 *   1. Vite, in the background — the SSR wizard's client bundle. `@repo/vite-assets`
 *      proxies `/vite/` to a listener on 5174, so with nothing bound there the
 *      page renders as inert HTML and every asset 404s.
 *   2. Nest, in the FOREGROUND — the container's exit code is the health of the
 *      server. Backgrounding Nest would make every crash look like a clean run.
 *
 * Running both from one script (rather than two turbo tasks) is what lets
 * `turbo watch dev --filter=setup` own the whole app: turbo sees one persistent
 * task per app, so its dependency rebuilds don't fight a second scheduler.
 */

import { spawn } from 'node:child_process';

const vite = spawn('bun', ['run', 'dev:vite'], { stdio: 'inherit', shell: true });
const nest = spawn('bun', ['run', 'dev:nest'], { stdio: 'inherit', shell: true });

// One shutdown path: whichever process dies takes the other with it, so the
// container never lingers half-alive.
let shuttingDown = false;
function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  vite.kill('SIGTERM');
  nest.kill('SIGTERM');
  process.exit(code);
}

vite.on('exit', (code) => shutdown(code ?? 1));
nest.on('exit', (code) => shutdown(code ?? 0)); // Nest exiting cleanly = handover done
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
