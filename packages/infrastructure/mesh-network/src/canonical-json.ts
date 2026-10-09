/**
 * Canonical JSON — the byte string every signature in the mesh is computed over.
 *
 * Two members sign and verify the SAME logical record on different machines, after
 * it has been parsed, merged and re-serialised any number of times. `JSON.stringify`
 * preserves insertion order, so a record whose keys were rebuilt in a different
 * order would serialise differently and every signature over it would fail. Keys
 * are therefore sorted at every depth; arrays keep their order because order is
 * meaningful there (endpoint candidates are ranked).
 */

export class CanonicalJsonError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CanonicalJsonError";
	}
}

function normalise(value: unknown, path: string): unknown {
	if (value === null) return null;
	switch (typeof value) {
		case "string":
		case "boolean":
			return value;
		case "number":
			// NaN/Infinity serialise as `null`, which would let two different
			// records share one signature.
			if (!Number.isFinite(value)) throw new CanonicalJsonError(`non-finite number at ${path}`);
			return value;
		case "object": {
			if (Array.isArray(value)) return value.map((item, index) => normalise(item, `${path}[${String(index)}]`));
			const record = value as Record<string, unknown>;
			const out: Record<string, unknown> = {};
			for (const key of Object.keys(record).sort()) {
				const child = record[key];
				// `undefined` is dropped exactly like JSON.stringify drops it, so an
				// optional field that is absent and one that is `undefined` sign alike.
				if (child === undefined) continue;
				out[key] = normalise(child, `${path}.${key}`);
			}
			return out;
		}
		default:
			throw new CanonicalJsonError(`unsupported ${typeof value} at ${path}`);
	}
}

/** Serialise `value` with sorted keys at every depth. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(normalise(value, "$"));
}
