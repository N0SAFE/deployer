/**
 * Turn the ISO strings a service answered with back into the `Date`s its contract declares.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Services are reached over OpenAPI JSON, where a `Date` travels as an ISO-8601 string. The
 * BFF then returns that value from a handler bound to the SAME contract, and oRPC validates a
 * handler's output against it: a `z.date()` field that holds a string fails with
 * `expected date, received string`, so every delegated route whose response carried a date
 * (`/user`, `/health/detailed`, …) answered `500 Output validation failed`.
 *
 * ── WHY SCHEMA-GUIDED AND NOT "EVERY ISO-LOOKING STRING" ────────────────────
 * A `z.string()` field may legitimately hold something that looks like a timestamp (a version
 * label, a user-typed name) and must stay a string. Only a position the schema declares as a
 * date is converted, so the walk follows the schema, not the data.
 *
 * Anything it does not understand is returned unchanged: an unrecognised schema must never
 * turn a valid response into an error.
 */

type ZodLike = {
	_zod?: { def?: Record<string, unknown> };
	safeParse?: (value: unknown) => { success: boolean };
};

const WRAPPERS = new Set(["optional", "nullable", "default", "prefault", "readonly", "nonoptional", "catch"]);

const defOf = (schema: unknown): Record<string, unknown> | undefined => (schema as ZodLike | undefined)?._zod?.def;

export function reviveDates(schema: unknown, value: unknown): unknown {
	if (value === null || value === undefined) return value;
	const def = defOf(schema);
	if (def === undefined) return value;
	const type = def.type as string | undefined;

	if (type !== undefined && WRAPPERS.has(type)) return reviveDates(def.innerType, value);

	switch (type) {
		case "date": {
			if (typeof value !== "string") return value;
			const parsed = new Date(value);
			return Number.isNaN(parsed.getTime()) ? value : parsed;
		}
		case "object": {
			if (typeof value !== "object" || Array.isArray(value)) return value;
			const shape = (def.shape ?? {}) as Record<string, unknown>;
			const source = value as Record<string, unknown>;
			const out: Record<string, unknown> = { ...source };
			for (const key of Object.keys(shape)) {
				if (key in source) out[key] = reviveDates(shape[key], source[key]);
			}
			return out;
		}
		case "array":
			return Array.isArray(value) ? value.map((item) => reviveDates(def.element, item)) : value;
		case "tuple": {
			if (!Array.isArray(value)) return value;
			const items = (def.items ?? []) as unknown[];
			return value.map((item, index) => reviveDates(items[index], item));
		}
		case "record": {
			if (typeof value !== "object" || Array.isArray(value)) return value;
			return Object.fromEntries(
				Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, reviveDates(def.valueType, item)]),
			);
		}
		case "pipe":
			return reviveDates(def.in, value);
		case "lazy": {
			const getter = def.getter as (() => unknown) | undefined;
			return getter === undefined ? value : reviveDates(getter(), value);
		}
		case "intersection":
			return reviveDates(def.right, reviveDates(def.left, value));
		case "union": {
			const options = (def.options ?? []) as ZodLike[];
			for (const option of options) {
				const revived = reviveDates(option, value);
				if (option.safeParse?.(revived).success) return revived;
			}
			return value;
		}
		default:
			return value;
	}
}
