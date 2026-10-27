import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `WAIT_FOR_DEPENDENCIES.waitMs` is read from `PREFLIGHT_WAIT_MS`, because one
 * compose profile has to wait longer than a boot normally should.
 *
 * The unit tests that assert retry BEHAVIOUR build their own policy (`waitMs: 5_000`
 * and friends), so they never exercise this reading. That is exactly why it needs
 * its own test: the default is what every real boot uses, and getting it wrong is
 * silent — a 0 would mean "never wait", which is the exit-5 restart loop coming
 * back, and a NaN would do the same.
 *
 * The module is re-imported per case because the value is read once at load: the
 * deadline must not move while it is being waited on.
 */
async function loadPolicy(env: Record<string, string | undefined>) {
	// `vi.resetModules` drops the cached module so the top-level read runs again.
	vi.resetModules();
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	const { WAIT_FOR_DEPENDENCIES, REPORT_ONLY } = await import("../runner");
	return { WAIT_FOR_DEPENDENCIES, REPORT_ONLY };
}

const ORIGINAL = process.env.PREFLIGHT_WAIT_MS;

afterEach(() => {
	if (ORIGINAL === undefined) delete process.env.PREFLIGHT_WAIT_MS;
	else process.env.PREFLIGHT_WAIT_MS = ORIGINAL;
});

describe("WAIT_FOR_DEPENDENCIES policy", () => {
	it("defaults to 60s when PREFLIGHT_WAIT_MS is unset", async () => {
		const { WAIT_FOR_DEPENDENCIES } = await loadPolicy({ PREFLIGHT_WAIT_MS: undefined });

		expect(WAIT_FOR_DEPENDENCIES.waitMs).toBe(60_000);
	});

	it("honours a configured wait", async () => {
		// The `dev:services` profile's value: long enough to outlast the setup
		// wizard that creates the database the services are already pointed at.
		const { WAIT_FOR_DEPENDENCIES } = await loadPolicy({ PREFLIGHT_WAIT_MS: "1800000" });

		expect(WAIT_FOR_DEPENDENCIES.waitMs).toBe(1_800_000);
	});

	it.each([
		["empty", ""],
		["not a number", "soon"],
		["negative", "-1"],
		["zero", "0"],
	])("falls back to 60s when PREFLIGHT_WAIT_MS is %s", async (_label, value) => {
		// A 0 would silently mean "never wait" — the exit-5 loop this knob exists
		// to prevent — so every unusable value must land on the safe default.
		const { WAIT_FOR_DEPENDENCIES } = await loadPolicy({ PREFLIGHT_WAIT_MS: value });

		expect(WAIT_FOR_DEPENDENCIES.waitMs).toBe(60_000);
	});

	it("still retries every 2s, so a short wait is not a busy loop", async () => {
		const { WAIT_FOR_DEPENDENCIES } = await loadPolicy({ PREFLIGHT_WAIT_MS: "1800000" });

		expect(WAIT_FOR_DEPENDENCIES.retryEveryMs).toBe(2_000);
	});

	it("REPORT_ONLY is unaffected — a caller asking a question never waits", async () => {
		const { REPORT_ONLY } = await loadPolicy({ PREFLIGHT_WAIT_MS: "1800000" });

		expect(REPORT_ONLY.waitMs).toBe(0);
	});
});
