import { describe, expect, it } from "vitest";

import { readFilter, readSortField } from "./user.filters";

describe("readFilter", () => {
	it("returns an empty filter for anything that is not an object", () => {
		for (const input of [undefined, null, "x", 3, true]) {
			expect(readFilter(input)).toEqual({});
		}
	});

	it("reads each operator entry as { operator, value }", () => {
		expect(
			readFilter({
				id: { operator: "eq", value: "u-1" },
				email: { operator: "like", value: "@example" },
				name: { operator: "ilike", value: "ad" },
				createdAt: { operator: "gte", value: "2026-01-01" },
			}),
		).toEqual({
			id: { operator: "eq", value: "u-1" },
			email: { operator: "like", value: "@example" },
			name: { operator: "ilike", value: "ad" },
			createdAt: { operator: "gte", value: "2026-01-01" },
		});
	});

	it("drops a malformed entry rather than passing it on", () => {
		expect(readFilter({ id: "u-1", email: { value: "x" }, name: { operator: 3 }, createdAt: null })).toEqual({});
	});

	it("keeps emailVerified only when it is a boolean", () => {
		expect(readFilter({ emailVerified: false })).toEqual({ emailVerified: false });
		expect(readFilter({ emailVerified: "false" })).toEqual({});
	});

	it("ignores fields the user filter does not know", () => {
		expect(readFilter({ role: { operator: "eq", value: "admin" } })).toEqual({});
	});
});

describe("readSortField", () => {
	it.each(["createdAt", "name", "email", "updatedAt"])("accepts %s", (field) => {
		expect(readSortField(field)).toBe(field);
	});

	it("falls back to createdAt for an unknown or missing field", () => {
		expect(readSortField("password")).toBe("createdAt");
		expect(readSortField(undefined)).toBe("createdAt");
	});
});
