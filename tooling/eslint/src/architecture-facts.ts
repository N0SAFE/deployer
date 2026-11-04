/**
 * The facts process: `bun architecture-facts <root> [globsJson]` prints the module-graph facts as JSON on stdout.
 * Spawned once per lint run by the rules (`rules/architecture/facts-client.ts`); not meant to be run by hand.
 */
import { resolve } from "node:path";

import z from "zod/v4";

import { collectFacts } from "./rules/architecture/facts-collector";
import { DEFAULT_GLOBS } from "./rules/architecture/facts-schema";

const [root = process.cwd(), globsJson] = process.argv.slice(2);
const globs = globsJson === undefined ? { success: true as const, data: [...DEFAULT_GLOBS] } : z.array(z.string()).safeParse(JSON.parse(globsJson));

if (!globs.success) {
	process.stderr.write("architecture-facts: the second argument must be a JSON array of globs.\n");
	process.exit(2);
}

const facts = await collectFacts(resolve(root), globs.data);
// Wait for the pipe to drain: the output of a whole monorepo is megabytes, and `exit` would cut it off.
await new Promise<void>((done) => process.stdout.write(JSON.stringify(facts), () => done()));
