import { describe, expect, it, vi } from "vitest";

import { checkDatabase, checkMigrations, checkRedis } from "../checks";
import { runPreflight } from "../runner";
import { PreflightDependency, type CheckContext } from "../types";

/**
 * A context that answers however the test wants, recording what was asked.
 *
 * The checks are pure functions over a {@link CheckContext} precisely so they can
 * be exercised like this — no database, no Redis, no Nest container.
 */
function contextOf(options: {
	query?: (sql: string) => Promise<Record<string, unknown>[]>;
	tcp?: () => Promise<void>;
	env?: Record<string, string>;
}): CheckContext {
	return {
		env: (key) => options.env?.[key],
		query: options.query ?? (async () => []),
		tcp: options.tcp ?? (async () => undefined),
		log: () => undefined,
	};
}

describe("checkDatabase", () => {
	it("passes when the query succeeds", async () => {
		const result = await checkDatabase(contextOf({ query: async () => [{ "?column?": 1 }] }));

		expect(result.outcome).toBe("ok");
		expect(result.dependency).toBe(PreflightDependency.Database);
	});

	it("fails with the driver's message when the query throws", async () => {
		const result = await checkDatabase(
			contextOf({
				query: async () => {
					throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
				},
			}),
		);

		// The message is kept verbatim: it is the most useful thing an operator gets.
		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("ECONNREFUSED");
	});
});

describe("checkMigrations", () => {
	it("passes when at least one migration is recorded", async () => {
		const result = await checkMigrations(contextOf({ query: async () => [{ applied: 38 }] }));

		expect(result.outcome).toBe("ok");
		expect(result.detail).toContain("38");
	});

	it("fails when the journal exists but is empty", async () => {
		// The case reachability cannot catch: a fresh Postgres accepts connections
		// and every query fails with `relation ... does not exist`.
		const result = await checkMigrations(contextOf({ query: async () => [{ applied: 0 }] }));

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("no migrations applied");
	});

	it("fails when the journal table does not exist", async () => {
		const result = await checkMigrations(
			contextOf({
				query: async () => {
					throw new Error('relation "drizzle.__drizzle_migrations" does not exist');
				},
			}),
		);

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("does not exist");
	});

	it("fails on an unreadable count rather than assuming zero", async () => {
		const result = await checkMigrations(contextOf({ query: async () => [] }));

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("unreadable");
	});
});

describe("checkRedis", () => {
	it("passes when the TCP connect succeeds", async () => {
		const tcp = vi.fn(async () => undefined);
		const result = await checkRedis(
			contextOf({ tcp, env: { DEPLOYER_REDIS_URL: "redis://redis:6379" } }),
		);

		expect(result.outcome).toBe("ok");
		expect(tcp).toHaveBeenCalledWith("redis", 6379, expect.any(Number));
	});

	it("defaults the port when the URL omits it", async () => {
		const tcp = vi.fn(async () => undefined);
		await checkRedis(contextOf({ tcp, env: { DEPLOYER_REDIS_URL: "redis://cache" } }));

		expect(tcp).toHaveBeenCalledWith("cache", 6379, expect.any(Number));
	});

	it("fails when the URL is not configured", async () => {
		const result = await checkRedis(contextOf({ env: {} }));

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("DEPLOYER_REDIS_URL");
	});

	it("fails on an unparseable URL instead of throwing", async () => {
		const result = await checkRedis(
			contextOf({ env: { DEPLOYER_REDIS_URL: "not a url" } }),
		);

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("unparseable");
	});
});

describe("runPreflight", () => {
	it("is ready when every dependency passes", async () => {
		const report = await runPreflight({
			context: contextOf({
				query: async () => [{ applied: 3 }],
				tcp: async () => undefined,
				env: { DEPLOYER_REDIS_URL: "redis://redis:6379" },
			}),
			dependencies: [
				PreflightDependency.Database,
				PreflightDependency.Migrations,
				PreflightDependency.Redis,
			],
			policy: { waitMs: 0, retryEveryMs: 0 },
		});

		expect(report.ready).toBe(true);
		expect(report.results).toHaveLength(3);
		expect(report.results.every((result) => result.outcome === "ok")).toBe(true);
	});

	it("reports every failing dependency rather than stopping at the first", async () => {
		const report = await runPreflight({
			context: contextOf({
				query: async () => {
					throw new Error("no database");
				},
				env: {},
			}),
			dependencies: [
				PreflightDependency.Database,
				PreflightDependency.Migrations,
				PreflightDependency.Redis,
			],
			policy: { waitMs: 0, retryEveryMs: 0 },
		});

		expect(report.ready).toBe(false);
		// "Is the database down?" and "are migrations applied?" are different
		// questions with different fixes, so both answers are reported.
		expect(report.results.filter((result) => result.outcome === "failed")).toHaveLength(3);
	});

	it("retries until the deadline, then reports", async () => {
		let attempts = 0;
		const report = await runPreflight({
			context: contextOf({
				query: async () => {
					attempts += 1;
					// Fail the first pass, succeed on the second — the case a boot must
					// survive (a dependency still starting).
					if (attempts <= 2) throw new Error("not yet");
					return [{ applied: 1 }];
				},
			}),
			dependencies: [PreflightDependency.Database, PreflightDependency.Migrations],
			policy: { waitMs: 5_000, retryEveryMs: 1 },
		});

		expect(report.ready).toBe(true);
		expect(attempts).toBeGreaterThan(2);
	});

	it("gives up when the deadline passes", async () => {
		const started = Date.now();
		const report = await runPreflight({
			context: contextOf({
				query: async () => {
					throw new Error("still down");
				},
			}),
			dependencies: [PreflightDependency.Database],
			policy: { waitMs: 30, retryEveryMs: 10 },
		});

		expect(report.ready).toBe(false);
		expect(Date.now() - started).toBeGreaterThanOrEqual(30);
	});

	it("is ready when there is nothing to check", async () => {
		const report = await runPreflight({
			context: contextOf({}),
			dependencies: [],
			policy: { waitMs: 0, retryEveryMs: 0 },
		});

		expect(report.ready).toBe(true);
		expect(report.results).toEqual([]);
	});
});
