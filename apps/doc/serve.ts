#!/usr/bin/env bun
/**
 * Static file server for the exported docs site.
 *
 * `output: 'export'` turns the app into a plain directory (`out/`) instead of a
 * Next server, so `next start` no longer applies. This serves that directory
 * the way the deployment target does — an object store with an index document —
 * so production and S3/CloudFront behave identically.
 *
 * Deliberately dumb: no routing, no rewrites, no framework. If a path is not a
 * file in `out/`, it is a 404. Anything smarter would diverge from S3.
 */

import { existsSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

const OUT_DIR = resolve(new URL('./out/', import.meta.url).pathname);
const PORT = Number(process.env.NEXT_PUBLIC_DOC_PORT ?? 3020);

if (!existsSync(OUT_DIR)) {
  console.error(`No export found at ${OUT_DIR}. Run \`bun --bun run build\` first.`);
  process.exit(1);
}

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

/**
 * Map a URL path to a file in `out/`, mirroring an object store's lookup:
 * exact object first, then the directory's index document.
 */
function lookup(pathname: string): { path: string; redirect?: string } | null {
  // `normalize` collapses `..`; the prefix check then rejects anything that
  // still escaped the output directory.
  const target = join(OUT_DIR, normalize(pathname));
  if (target !== OUT_DIR && !target.startsWith(`${OUT_DIR}/`)) return null;

  if (isFile(target)) return { path: target };

  // A directory: an object store redirects `/docs` -> `/docs/`, then serves
  // the index document. `trailingSlash: true` in next.config.ts is what makes
  // the export produce `docs/index.html` for this to find.
  const index = join(target.endsWith('/') ? target : `${target}/`, 'index.html');
  if (!isFile(index)) return null;

  return pathname.endsWith('/') ? { path: index } : { path: index, redirect: `${pathname}/` };
}

/** Hashed build assets never change; everything else revalidates. */
const cacheControl = (path: string): string =>
  path.includes('/_next/static/')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate';

const notFound = join(OUT_DIR, '404.html');

Bun.serve({
  port: PORT,
  fetch(req) {
    const { pathname } = new URL(req.url);
    const hit = lookup(decodeURIComponent(pathname));

    if (hit?.redirect) {
      return new Response(null, { status: 308, headers: { Location: hit.redirect } });
    }

    const path = hit?.path ?? notFound;
    // `wget --spider` in the Docker healthcheck sends HEAD, which must not
    // carry a body.
    const body = req.method === 'HEAD' ? null : Bun.file(path);

    return new Response(body, {
      status: hit ? 200 : 404,
      headers: { 'Cache-Control': cacheControl(path) },
    });
  },
});

console.log(`Serving ${OUT_DIR} on http://localhost:${PORT}`);
