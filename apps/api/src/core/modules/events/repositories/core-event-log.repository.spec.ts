import { describe, expect, it } from "vitest";

import { sanitizeForPostgres } from "./core-event-log.repository";

/**
 * Postgres rejects U+0000 in `text` and `jsonb`, so a single NUL in one row
 * failed the WHOLE `insertMany` batch and the audit log stayed unwritable while
 * its queue grew. These are the shapes that actually carry it.
 */
describe("sanitizeForPostgres", () => {
	it("removes NUL from a plain string", () => {
		expect(sanitizeForPostgres("before\u0000after")).toBe("beforeafter");
	});

	it("leaves a string without NUL untouched (identity, not a copy)", () => {
		const value = "clean";
		expect(sanitizeForPostgres(value)).toBe(value);
	});

	it("removes NUL from nested strings in an object", () => {
		const input = { stepId: "provis\u0000ioning", nested: { log: "a\u0000b" } };
		expect(sanitizeForPostgres(input)).toEqual({
			stepId: "provisioning",
			nested: { log: "ab" },
		});
	});

	it("removes NUL from array entries", () => {
		expect(sanitizeForPostgres(["a\u0000", "b"])).toEqual(["a", "b"]);
	});

	it("removes NUL from a KEY as well as a value", () => {
		// A key is a string too, and breaks the insert the same way.
		expect(sanitizeForPostgres({ "k\u0000ey": "v" })).toEqual({ key: "v" });
	});

	it("preserves non-plain objects so the driver keeps their type", () => {
		// Rebuilding a Date as a plain object would send an empty record.
		const date = new Date("2026-10-07T00:00:00.000Z");
		const result = sanitizeForPostgres({ at: date }) as { at: unknown };
		expect(result.at).toBe(date);
		expect(result.at).toBeInstanceOf(Date);
	});

	it("passes through primitives that cannot contain a NUL", () => {
		expect(sanitizeForPostgres(42)).toBe(42);
		expect(sanitizeForPostgres(true)).toBe(true);
		expect(sanitizeForPostgres(null)).toBeNull();
		expect(sanitizeForPostgres(undefined)).toBeUndefined();
	});

	it("handles deep nesting without losing structure", () => {
		const input = { a: [{ b: "x\u0000y" }, "z\u0000"] };
		expect(sanitizeForPostgres(input)).toEqual({ a: [{ b: "xy" }, "z"] });
	});
});
