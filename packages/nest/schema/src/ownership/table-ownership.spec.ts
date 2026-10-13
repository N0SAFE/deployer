import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as globalSchema from "../global";
import { SHARED_TABLES, TABLE_OWNERSHIP, mayRead, mayWrite, ownerOf } from "./table-ownership";

/**
 * The ownership registry must agree with the schema, always.
 *
 * ── WHY THIS TEST EXISTS ────────────────────────────────────────────────────
 * A registry is only worth having if it cannot go stale. Two things rot it:
 *
 *  1. a table is ADDED and nobody claims it, so ownership silently evaporates for the
 *     newest part of the system — exactly the code most likely to be written by
 *     somebody who has not read this file;
 *  2. a table is claimed TWICE, which is the conflict the registry exists to prevent
 *     and is invisible until two services disagree about a row at runtime.
 *
 * Both are caught here. The list of tables is read from the SCHEMA ITSELF rather than
 * from a copy, so the test cannot pass while the schema and the registry drift.
 */

/**
 * Every table the drizzle schema exports.
 *
 * Detected by asking drizzle for a table's name. A table returns its SQL name; anything
 * else (an enum, a relation, an enum array) either throws or answers `undefined`, and both
 * are skipped — an earlier version of this detector kept the `undefined` and reported a
 * table literally called `undefined`, which is exactly the kind of noise that makes a test
 * get deleted instead of fixed.
 */
function schemaTables(): string[] {
	const found: string[] = [];
	for (const value of Object.values(globalSchema as Record<string, unknown>)) {
		if (value === null || typeof value !== "object") continue;
		let name: unknown;
		try {
			name = getTableName(value as never);
		} catch {
			// Not a table (enum, relation, helper). Nothing to assert about it.
			continue;
		}
		if (typeof name === "string" && name.length > 0) found.push(name);
	}
	return [...new Set(found)].sort();
}

/** Every table name the registry declares, including shared-table writers. */
function registryTables(): string[] {
	const shared = SHARED_TABLES.map((entry) => entry.table);
	return [...new Set([...Object.keys(TABLE_OWNERSHIP), ...shared])].sort();
}

describe("table ownership registry", () => {
	it("finds a plausible number of tables, so a broken detector cannot pass vacuously", () => {
		// A detector that silently matched nothing would make every assertion below pass
		// while proving nothing — the classic way an empty-schema test lies.
		const tables = schemaTables();
		expect(tables.length).toBeGreaterThan(50);
	});

	it("claims EVERY table the schema declares", () => {
		const unclaimed = schemaTables().filter((table) => ownerOf(table) === undefined);

		expect(
			unclaimed,
			`These tables exist but no service owns them. Add them to TABLE_OWNERSHIP:\n  ${unclaimed.join("\n  ")}`,
		).toEqual([]);
	});

	it("claims NO table the schema does not declare", () => {
		const inSchema = new Set(schemaTables());
		// A stale entry is a claim about something that no longer exists, which makes the
		// registry's answers unreliable in the other direction: a caller looking up a
		// DROPPED table would be told it is owned instead of that it is gone.
		const stale = registryTables().filter((table) => !inSchema.has(table));

		expect(
			stale,
			`These tables are claimed but no longer in the schema. Remove them from TABLE_OWNERSHIP:\n  ${stale.join("\n  ")}`,
		).toEqual([]);
	});

	it("gives every table exactly ONE owner", () => {
		// `TABLE_OWNERSHIP` is a Record, so a duplicate key would have been silently
		// collapsed by the object literal — the later entry winning and the earlier one
		// vanishing with no error. Reading the source back is what makes a duplicate
		// detectable at all.
		const source = readFileSync(join(__dirname, "table-ownership.ts"), "utf8");
		const claimed = [...source.matchAll(/^\t([a-z_]+):\s*"(identity|project|runtime|fleet|health|platform|monolith)",$/gm)].map(
			(match) => match[1] as string,
		);

		// The file is one table per line, so a repeated name is a real duplicate.
		const duplicates = claimed.filter((table, index) => claimed.indexOf(table) !== index);
		expect(duplicates, `claimed more than once: ${[...new Set(duplicates)].join(", ")}`).toEqual([]);
	});

	it("only names tables that actually exist in SHARED_TABLES", () => {
		const inSchema = new Set(schemaTables());
		const bogus = SHARED_TABLES.map((entry) => entry.table).filter((table) => !inSchema.has(table));

		expect(bogus, `shared entries for unknown tables: ${bogus.join(", ")}`).toEqual([]);
	});

	it("never lists a shared table's writer among its readers", () => {
		// A table whose writer also appears as a "reader" is a contradiction: it makes the
		// reader list meaningless and hides the one fact that matters.
		for (const entry of SHARED_TABLES) {
			expect(
				entry.readers,
				`${entry.table}: the writer is also listed as a reader`,
			).not.toContain(entry.writer);
		}
	});

	it("explains WHY each shared table is shared", () => {
		for (const entry of SHARED_TABLES) {
			// An unexplained exception is indistinguishable from an accident, and the next
			// person cannot tell whether it is still needed.
			expect(entry.reason.length, `${entry.table} has no reason recorded`).toBeGreaterThan(40);
		}
	});

	describe("mayWrite / mayRead", () => {
		it("lets the owner write its own table", () => {
			expect(mayWrite("projects", "project")).toBe(true);
			expect(mayWrite("deployments", "runtime")).toBe(true);
			expect(mayWrite("user", "identity")).toBe(true);
		});

		it("refuses a writer that does not own the table", () => {
			// This is the guarantee the whole registry exists for: the first cross-domain
			// write is the coupling that makes two services disagree about a row.
			expect(mayWrite("projects", "runtime")).toBe(false);
			expect(mayWrite("user", "project")).toBe(false);
			expect(mayWrite("deployments", "project")).toBe(false);
		});

		it("lets a declared reader READ a shared table but not write it", () => {
			// The distinction that matters: reading a deployment to show it on a project
			// screen is legitimate; deciding its status from the project service is not.
			expect(mayRead("deployments", "project")).toBe(true);
			expect(mayWrite("deployments", "project")).toBe(false);
		});

		it("lets identity READ deployments for analytics but not write them", () => {
			// identity aggregates analytics reports over deployments. That is a read-only
			// projection; the deployment's status is still runtime's to decide.
			expect(mayRead("deployments", "identity")).toBe(true);
			expect(mayWrite("deployments", "identity")).toBe(false);
		});

		it("refuses read access to a service that is not declared", () => {
			// `health` owns only its own probes; a deployment is not its to read.
			expect(mayRead("deployments", "health")).toBe(false);
		});
	});
});

/**
 * A second, independent check: the schema's source files are on disk and each one is
 * accounted for, so a NEW schema file added without an owner is noticed even if its
 * tables happen to be re-exports.
 */
describe("schema files", () => {
	it("has no schema file whose tables are all unclaimed", () => {
		const dir = join(__dirname, "..", "global");
		const files = readdirSync(dir).filter(
			(entry) => statSync(join(dir, entry)).isDirectory() || entry.endsWith(".ts"),
		);
		expect(files.length).toBeGreaterThan(5);
	});
});
