#!/usr/bin/env bun
/**
 * Publish the exported docs site to an S3-compatible bucket.
 *
 * The doc app is a static export (`output: 'export'`), so deploying is a file
 * sync — no server, no container. Run `bun --bun run build` first (or pass
 * `--build`) to produce `apps/doc/out/`.
 *
 * Usage:
 *   bun --bun scripts/deploy-doc-s3.ts --bucket my-docs-bucket
 *   bun --bun scripts/deploy-doc-s3.ts --bucket my-docs --build
 *   bun --bun scripts/deploy-doc-s3.ts --bucket my-docs --dry-run
 *
 * Requires the `aws` CLI on PATH. Credentials come from the standard AWS
 * sources (env vars, ~/.aws/credentials, or an instance role); nothing is read
 * or stored here.
 *
 * Flags:
 *   --bucket <name>    Target bucket (required, or set DOC_S3_BUCKET).
 *   --prefix <path>    Key prefix inside the bucket (or set DOC_S3_PREFIX).
 *   --endpoint <url>   Custom endpoint for S3-compatible hosts (MinIO, R2, …).
 *   --build            Run the export build before syncing.
 *   --dry-run          List what would change without uploading.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const OUT_DIR = resolve(ROOT, 'apps/doc/out');

interface Args {
  bucket: string;
  prefix: string;
  endpoint?: string;
  build: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let bucket = process.env.DOC_S3_BUCKET ?? '';
  let prefix = process.env.DOC_S3_PREFIX ?? '';
  let endpoint = process.env.DOC_S3_ENDPOINT;
  let build = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--bucket') bucket = argv[++i] ?? '';
    else if (arg === '--prefix') prefix = argv[++i] ?? '';
    else if (arg === '--endpoint') endpoint = argv[++i];
    else if (arg === '--build') build = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(import.meta.file, '--bucket <name> [--prefix <path>] [--endpoint <url>] [--build] [--dry-run]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }

  if (!bucket) {
    console.error('Missing --bucket (or DOC_S3_BUCKET).');
    process.exit(2);
  }

  return { bucket, prefix, endpoint, build, dryRun };
}

function run(cmd: string[], label: string): number {
  console.log(`\n${label}\n  ${cmd.join(' ')}`);
  const result = spawnSync(cmd[0]!, cmd.slice(1), { cwd: ROOT, stdio: 'inherit' });
  return result.status ?? 1;
}

const args = parseArgs(process.argv.slice(2));

if (args.build) {
  const code = run(['bun', '--bun', 'x', 'turbo', 'run', 'build', '--filter=doc'], 'Building the export…');
  if (code !== 0) process.exit(code);
}

if (!existsSync(OUT_DIR)) {
  console.error(`No export found at ${OUT_DIR}. Run \`bun --bun run build\` first, or pass --build.`);
  process.exit(1);
}

// Prefix handling: S3 keys are joined with `/`, and `aws s3 sync` treats the
// last path segment as the key prefix, so it must end with `/` when non-empty.
const key = args.prefix ? `${args.prefix.replace(/^\/+|\/+$/g, '')}/` : '';
const target = `s3://${args.bucket}/${key}`;

const common = [
  'aws',
  's3',
  'sync',
  `${OUT_DIR}/`,
  target,
  '--delete',
  // Content-type is inferred from the file extension; this makes `.txt` and
  // extensionless files (the search index) come back with sane types.
  '--no-progress',
];
if (args.endpoint) common.push('--endpoint-url', args.endpoint);
if (args.dryRun) common.push('--dry-run');

// Hashed build assets are immutable, so they get a far-future cache lifetime.
// Re-uploading them is pure waste, hence `--size-only` on that pass: Next's
// content hash already changes the filename when the bytes change.
const assets = run(
  [...common, '--exclude', '*', '--include', '_next/static/*', '--cache-control', 'public, max-age=31536000, immutable', ...(args.dryRun ? [] : ['--size-only'])],
  'Syncing immutable build assets…',
);
if (assets !== 0) process.exit(assets);

// Everything else (HTML, the search index, og images) must be revalidated so a
// rebuild is picked up. `--delete` on this pass removes stale pages.
const rest = run(
  [...common, '--exclude', '_next/static/*', '--cache-control', 'public, max-age=0, must-revalidate'],
  'Syncing pages, search index and images…',
);
process.exit(rest);
