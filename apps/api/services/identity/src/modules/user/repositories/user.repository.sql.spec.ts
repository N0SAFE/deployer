import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { buildWhere, toUser, USER_SORT_COLUMNS } from "./user.repository.sql";

const dialect = new PgDialect();

/** Render a where clause to its SQL text and bound parameters. */
const render = (filter: Parameters<typeof buildWhere>[0]) => {
	const where = buildWhere(filter);
	return where === undefined ? undefined : dialect.sqlToQuery(where);
};

describe("buildWhere", () => {
	it("is undefined when no condition applies", () => {
		expect(buildWhere({})).toBeUndefined();
	});

	it("matches an id exactly, and only for a string value", () => {
		expect(render({ id: { operator: "eq", value: "u-1" } })).toMatchObject({ params: ["u-1"] });
		expect(buildWhere({ id: { operator: "eq", value: 7 } })).toBeUndefined();
		expect(buildWhere({ id: { operator: "like", value: "u" } })).toBeUndefined();
	});

	it("uses equality for eq and a contains match for like / ilike on text columns", () => {
		expect(render({ email: { operator: "eq", value: "a@b.co" } })).toMatchObject({ params: ["a@b.co"] });
		expect(render({ name: { operator: "like", value: "ad" } })).toMatchObject({ params: ["%ad%"] });
		expect(render({ name: { operator: "ilike", value: "ad" } })?.sql).toContain("ilike");
	});

	it("ignores an unsupported text operator or a non-string value", () => {
		expect(buildWhere({ name: { operator: "gt", value: "a" } })).toBeUndefined();
		expect(buildWhere({ name: { operator: "like", value: 5 } })).toBeUndefined();
	});

	it("filters emailVerified only on a boolean", () => {
		expect(render({ emailVerified: true })).toMatchObject({ params: [true] });
		expect(buildWhere({ emailVerified: "yes" })).toBeUndefined();
	});

	it.each(["gt", "gte", "lt", "lte"])("applies %s to a single date", (operator) => {
		const date = new Date("2026-01-01T00:00:00Z");

		expect(render({ createdAt: { operator, value: date } })?.params).toHaveLength(1);
	});

	it("applies between to two dates, and refuses it with one", () => {
		const a = new Date("2026-01-01T00:00:00Z");
		const b = new Date("2026-02-01T00:00:00Z");

		expect(render({ createdAt: { operator: "between", value: [a, b] } })?.params).toHaveLength(2);
		expect(buildWhere({ createdAt: { operator: "between", value: a } })).toBeUndefined();
	});

	it("ignores a createdAt value that is not a valid date", () => {
		expect(buildWhere({ createdAt: { operator: "gt", value: "2026-01-01" } })).toBeUndefined();
		expect(buildWhere({ createdAt: { operator: "gt", value: new Date("nope") } })).toBeUndefined();
		expect(buildWhere({ createdAt: { operator: "gt", value: [] } })).toBeUndefined();
	});

	it("combines every applicable condition", () => {
		const query = render({
			id: { operator: "eq", value: "u-1" },
			name: { operator: "like", value: "ad" },
			emailVerified: true,
		});

		expect(query?.params).toEqual(["u-1", "%ad%", true]);
		expect(query?.sql).toContain(" and ");
	});
});

describe("USER_SORT_COLUMNS", () => {
	it("maps exactly the four sortable fields to columns", () => {
		expect(Object.keys(USER_SORT_COLUMNS).sort()).toEqual(["createdAt", "email", "name", "updatedAt"]);
	});
});

describe("toUser", () => {
	const row = {
		id: "u-1",
		name: "Ada",
		email: "ada@example.com",
		emailVerified: true,
		image: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-02T00:00:00Z"),
		role: "admin",
		banned: false,
	} as Parameters<typeof toUser>[0];

	it("maps a row, keeping a known role and the banned flag", () => {
		expect(toUser(row)).toMatchObject({ id: "u-1", role: "admin", banned: false, image: null });
	});

	it("omits a role the domain does not know and a banned flag that is null", () => {
		const mapped = toUser({ ...row, role: "owner", banned: null });

		expect(mapped).not.toHaveProperty("role");
		expect(mapped).not.toHaveProperty("banned");
	});
});
