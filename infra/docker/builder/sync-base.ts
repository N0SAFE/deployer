#!/usr/bin/env bun
/**
 * Keeps the shared base stages of every builder Dockerfile byte-identical to `Dockerfile.base`.
 *
 * A Dockerfile cannot include another, and BuildKit keys a layer on the instruction text. So the way to make eight images
 * share their base layers (apk, node, turbo, bun download cache) is for the text to be identical: `Dockerfile.base` is the
 * single source, and the block between the `shared-base` markers in each Dockerfile is a verbatim copy of it.
 *
 *   bun sync-base.ts          rewrite the blocks
 *   bun sync-base.ts --check  fail when one has drifted (CI / pre-push)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dirname;
const BEGIN = (stage: string) => `# >>> ${stage} (generated from ../Dockerfile.base by sync-base.ts; do not edit here)`;
const END = (stage: string) => `# <<< ${stage}`;

const source = readFileSync(join(dir, "Dockerfile.base"), "utf8");
const block = (stage: string): string => {
	const match = new RegExp(`# >>> ${stage}\\n([\\s\\S]*?)# <<< ${stage}`).exec(source);
	if (match?.[1] === undefined) throw new Error(`Dockerfile.base has no ${stage} block`);
	return match[1].trimEnd();
};

const TARGETS: Record<string, "prod" | "dev"> = {
	"api/Dockerfile.api.prod": "prod",
	"setup/Dockerfile.setup.prod": "prod",
	"doc/Dockerfile.doc.build-time.prod": "prod",
	"doc/Dockerfile.doc.runtime.prod": "prod",
	"web/Dockerfile.web.build-time.prod": "prod",
	"web/Dockerfile.web.runtime.prod": "prod",
	"node-agent/Dockerfile.svc-node-agent": "prod",
	"app/Dockerfile.app.dev": "dev",
	"dependency-builder/Dockerfile.dependency-builder.dev": "dev",
};

const check = process.argv.includes("--check");
let drifted = 0;
for (const [file, kind] of Object.entries(TARGETS)) {
	const path = join(dir, file);
	const text = readFileSync(path, "utf8");
	const stage = `shared-${kind}-base`;
	const re = new RegExp(`${BEGIN(stage).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?\\n${END(stage)}`);
	if (!re.test(text)) throw new Error(`${file}: no ${stage} markers`);
	const next = text.replace(re, () => `${BEGIN(stage)}\n${block(stage)}\n${END(stage)}`);
	if (next === text) continue;
	drifted += 1;
	if (check) console.error(`drifted: ${file}`);
	else writeFileSync(path, next);
}
if (check && drifted > 0) process.exit(1);
