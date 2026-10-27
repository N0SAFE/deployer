import { describe, expect, it } from "vitest";
import z from "zod/v4";

import { reviveDates } from "../revive-dates";

const iso = "2026-10-27T10:00:00.000Z";

describe("reviveDates", () => {
	it("turns a date position into a Date", () => {
		expect(reviveDates(z.date(), iso)).toEqual(new Date(iso));
	});

	it("leaves a string position alone even when it looks like a timestamp", () => {
		expect(reviveDates(z.string(), iso)).toBe(iso);
	});

	it("revives nested objects, arrays and records by following the schema", () => {
		const schema = z.object({
			data: z.array(z.object({ id: z.string(), createdAt: z.date(), label: z.string() })),
			meta: z.object({ at: z.date().optional() }),
			byKey: z.record(z.string(), z.date()),
		});

		const result = reviveDates(schema, {
			data: [{ id: "1", createdAt: iso, label: iso }],
			meta: { at: iso },
			byKey: { a: iso },
		}) as z.infer<typeof schema>;

		expect(result.data[0]?.createdAt).toEqual(new Date(iso));
		expect(result.data[0]?.label).toBe(iso);
		expect(result.meta.at).toEqual(new Date(iso));
		expect(result.byKey.a).toEqual(new Date(iso));
		expect(schema.safeParse(result).success).toBe(true);
	});

	it("sees through optional, nullable and default wrappers", () => {
		const schema = z.object({ a: z.date().nullable(), b: z.date().default(new Date(0)), c: z.date().optional() });

		const result = reviveDates(schema, { a: iso, b: iso }) as { a: Date; b: Date };

		expect(result.a).toEqual(new Date(iso));
		expect(result.b).toEqual(new Date(iso));
	});

	it("keeps null and undefined as they are", () => {
		expect(reviveDates(z.date().nullable(), null)).toBeNull();
		expect(reviveDates(z.object({ a: z.date().optional() }), {})).toEqual({});
	});

	it("picks the union branch that accepts the revived value", () => {
		const schema = z.union([z.object({ kind: z.literal("a"), at: z.date() }), z.object({ kind: z.literal("b"), at: z.string() })]);

		expect((reviveDates(schema, { kind: "a", at: iso }) as { at: Date }).at).toEqual(new Date(iso));
		expect((reviveDates(schema, { kind: "b", at: iso }) as { at: string }).at).toBe(iso);
	});

	it("leaves an unparseable date string and unknown schemas unchanged", () => {
		expect(reviveDates(z.date(), "not a date")).toBe("not a date");
		expect(reviveDates(z.any(), iso)).toBe(iso);
		expect(reviveDates({ not: "a schema" }, iso)).toBe(iso);
		expect(reviveDates(undefined, iso)).toBe(iso);
	});

	it("does not mutate its input", () => {
		const input = { createdAt: iso };

		reviveDates(z.object({ createdAt: z.date() }), input);

		expect(input.createdAt).toBe(iso);
	});
});
