import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reseal sweep upgrades legacy ciphertext to the sealed form (SEC-016). What must hold:
 * it finds EVERY encrypted column by probing (no hand-kept list), it never overwrites a row
 * another writer changed, it never leaks a value into its report, and it is idempotent.
 *
 * Like the codec spec, each case starts from a genuinely unconfigured registry
 * (`vi.resetModules` + dynamic import) because the registry is module-level state.
 */

const LEGACY_KEY = Buffer.from("a".repeat(64), "hex");

type Modules = {
	codec: typeof import("../codec-registry");
	reseal: typeof import("../reseal");
};

async function fresh(): Promise<Modules> {
	vi.resetModules();
	const codec = await import("../codec-registry");
	const reseal = await import("../reseal");
	return { codec, reseal };
}

/** A deterministic sealer: the sweep's routing is under test here, not the crypto. */
const sealer = {
	seal: (plaintext: string) => `enc:v1:${Buffer.from(plaintext).toString("base64")}`,
	open: (stored: string) => Buffer.from(stored.slice("enc:v1:".length), "base64").toString("utf8"),
};

/** In-memory `ResealStore` over rows keyed by id, honouring the same contract as the SQL one. */
function memoryStore(rows: Map<string, string>, hooks: { beforeReplace?: (id: string) => void } = {}) {
	const unsealed = ([, value]: [string, string]) => value !== "" && !value.startsWith("enc:v1:");
	return {
		rows,
		replaceCalls: [] as string[],
		readUnsealed: async (_t: unknown, afterId: string | null, limit: number) =>
			[...rows.entries()]
				.filter(unsealed)
				.filter(([id]) => afterId === null || id > afterId)
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.slice(0, limit)
				.map(([id, value]) => ({ id, value })),
		replace: async function (this: { replaceCalls: string[] }, _t: unknown, id: string, expected: string, next: string) {
			this.replaceCalls.push(id);
			hooks.beforeReplace?.(id);
			if (rows.get(id) !== expected) return false;
			rows.set(id, next);
			return true;
		},
		countUnsealed: async () => [...rows.entries()].filter(unsealed).length,
	};
}

const target = { table: "secrets", column: "token", primaryKey: "id" } as const;

describe("findEncryptedColumns", () => {
	it("finds encrypted text columns by probing, and nothing else", async () => {
		const { codec, reseal } = await fresh();
		codec.configureSchemaCodecs({ encryption: { resolveKey: () => LEGACY_KEY }, sealing: sealer });
		const secrets = pgTable("secrets", { id: text("id").primaryKey(), token: codec.encryptedText("token").notNull(), label: text("label") });
		const other = pgTable("dns", { id: text("id").primaryKey(), credentials: codec.encryptedText("credentials") });
		const plain = pgTable("plain", { id: text("id").primaryKey(), name: text("name") });

		const { targets, skipped } = reseal.findEncryptedColumns({ secrets, other, plain, notATable: 42 });

		expect(targets).toEqual([
			{ table: "secrets", column: "token", primaryKey: "id" },
			{ table: "dns", column: "credentials", primaryKey: "id" },
		]);
		expect(skipped).toEqual([]);
	});

	it("de-duplicates a table that several service schemas declare under the same name", async () => {
		const { codec, reseal } = await fresh();
		codec.configureSchemaCodecs({ sealing: sealer });
		const a = pgTable("github_providers", { id: text("id").primaryKey(), secret: codec.encryptedText("secret") });
		const b = pgTable("github_providers", { id: text("id").primaryKey(), secret: codec.encryptedText("secret") });

		expect(reseal.findEncryptedColumns({ a, b }).targets).toHaveLength(1);
	});

	it("skips, and reports, an encrypted column on a table without exactly one primary key column", async () => {
		const { codec, reseal } = await fresh();
		codec.configureSchemaCodecs({ sealing: sealer });
		const composite = pgTable(
			"composite",
			{ a: text("a"), b: text("b"), secret: codec.encryptedText("secret") },
			(t) => [primaryKey({ columns: [t.a, t.b] })],
		);

		const { targets, skipped } = reseal.findEncryptedColumns({ composite });

		expect(targets).toEqual([]);
		expect(skipped).toEqual([{ table: "composite", column: "secret", reason: "needs exactly one primary key column" }]);
	});

	it("ignores a custom text column whose codec is not configured instead of crashing", async () => {
		const { codec, reseal } = await fresh();
		// Nothing configured: probing throws inside the codec, which must be tolerated.
		const secrets = pgTable("secrets", { id: text("id").primaryKey(), token: codec.encryptedText("token") });

		expect(reseal.findEncryptedColumns({ secrets }).targets).toEqual([]);
	});
});

describe("resealEncryptedColumns", () => {
	let m: Modules;
	let legacy: (plaintext: string) => string;

	beforeEach(async () => {
		m = await fresh();
		m.codec.configureEncryption({ resolveKey: () => LEGACY_KEY });
		const encrypt = m.codec.encryptSecret; // no sealer yet: legacy form
		legacy = (plaintext) => encrypt(plaintext);
	});

	const seeded = () =>
		new Map([
			["1", legacy("alpha")],
			["2", legacy("beta")],
			["3", ""], // empty: never touched
			["4", legacy("gamma")],
		]);

	it("dry-run reports what would change and writes nothing", async () => {
		const store = memoryStore(seeded());
		const before = new Map(store.rows);
		m.codec.configureSealing(sealer);

		const report = await m.reseal.resealEncryptedColumns(store, [target], { dryRun: true });

		expect(store.rows).toEqual(before);
		expect(store.replaceCalls).toEqual([]);
		expect(report.totalRemaining).toBe(3);
		expect(report.columns[0]).toMatchObject({ scanned: 3, resealed: 0, remaining: 3 });
	});

	it("re-encrypts every legacy row, preserves the plaintext, and ends with zero remaining", async () => {
		const store = memoryStore(seeded());
		m.codec.configureSealing(sealer);

		const report = await m.reseal.resealEncryptedColumns(store, [target], { dryRun: false });

		expect(report.columns[0]).toMatchObject({ scanned: 3, resealed: 3, remaining: 0, conflicts: 0 });
		expect(report.totalRemaining).toBe(0);
		expect(m.codec.decryptSecret(store.rows.get("1") ?? "")).toBe("alpha");
		expect(m.codec.decryptSecret(store.rows.get("4") ?? "")).toBe("gamma");
		expect(store.rows.get("3")).toBe("");
		for (const id of ["1", "2", "4"]) expect(m.codec.isSealedValue(store.rows.get(id) ?? "")).toBe(true);
	});

	it("is idempotent: a second run changes nothing", async () => {
		const store = memoryStore(seeded());
		m.codec.configureSealing(sealer);
		await m.reseal.resealEncryptedColumns(store, [target], { dryRun: false });
		const after = new Map(store.rows);
		store.replaceCalls.length = 0;

		const second = await m.reseal.resealEncryptedColumns(store, [target], { dryRun: false });

		expect(store.rows).toEqual(after);
		expect(store.replaceCalls).toEqual([]);
		expect(second.columns[0]).toMatchObject({ scanned: 0, resealed: 0, remaining: 0 });
	});

	it("pages through the table in batches", async () => {
		const rows = new Map(Array.from({ length: 7 }, (_, i) => [String(i + 1), legacy(`v${String(i)}`)] as const));
		const store = memoryStore(rows);
		m.codec.configureSealing(sealer);

		const report = await m.reseal.resealEncryptedColumns(store, [target], { dryRun: false, batchSize: 2 });

		expect(report.columns[0]).toMatchObject({ scanned: 7, resealed: 7, remaining: 0 });
	});

	it("never overwrites a row another writer changed after it was read, and a re-run picks it up", async () => {
		const rows = seeded();
		// Produced BEFORE the sealer is configured, so the "other writer" really leaves a legacy value behind.
		const changedConcurrently = legacy("changed-concurrently");
		const store = memoryStore(rows, {
			beforeReplace: (id) => {
				if (id === "2") rows.set("2", changedConcurrently);
			},
		});
		m.codec.configureSealing(sealer);

		const first = await m.reseal.resealEncryptedColumns(store, [target], { dryRun: false });
		expect(first.columns[0]).toMatchObject({ resealed: 2, conflicts: 1, remaining: 1 });

		const second = await m.reseal.resealEncryptedColumns(memoryStore(rows), [target], { dryRun: false });
		expect(second.totalRemaining).toBe(0);
		expect(m.codec.decryptSecret(rows.get("2") ?? "")).toBe("changed-concurrently");
	});

	it("reports, and leaves untouched, rows it cannot decrypt", async () => {
		const rows = seeded();
		rows.set("2", `${"0".repeat(64)}:${"0".repeat(32)}:${"0".repeat(32)}:deadbeef`); // legacy shape, wrong key
		const store = memoryStore(rows);
		m.codec.configureSealing(sealer);

		const report = await m.reseal.resealEncryptedColumns(store, [target], { dryRun: false });

		expect(report.columns[0]).toMatchObject({ failed: ["2"], resealed: 2, remaining: 1 });
		expect(report.totalRemaining).toBe(1);
		expect(rows.get("2")).toContain("deadbeef");
	});

	it("reports plaintext rows as unrecognised by default and seals them only on request", async () => {
		const rows = new Map([["1", "plaintext-secret"], ["2", legacy("legacy-secret")]]);
		m.codec.configureSealing(sealer);

		const report = await m.reseal.resealEncryptedColumns(memoryStore(rows), [target], { dryRun: false });
		expect(report.columns[0]).toMatchObject({ unrecognised: ["1"], resealed: 1, remaining: 1 });
		expect(rows.get("1")).toBe("plaintext-secret");

		const sealed = await m.reseal.resealEncryptedColumns(memoryStore(rows), [target], { dryRun: false, sealPlaintext: true });
		expect(sealed.totalRemaining).toBe(0);
		expect(m.codec.decryptSecret(rows.get("1") ?? "")).toBe("plaintext-secret");
	});

	it("refuses to run when no sealing codec is configured (it would upgrade nothing)", async () => {
		const store = memoryStore(seeded());

		await expect(m.reseal.resealEncryptedColumns(store, [target], { dryRun: false })).rejects.toThrow(/sealing codec is not configured/);
		expect(store.replaceCalls).toEqual([]);
	});

	it("never puts a plaintext or ciphertext value in the report", async () => {
		const rows = seeded();
		rows.set("9", "plaintext-secret");
		const original = new Map(rows);
		m.codec.configureSealing(sealer);

		const report = JSON.stringify(await m.reseal.resealEncryptedColumns(memoryStore(rows), [target], { dryRun: false }));

		for (const value of [...original.values(), "alpha", "beta", "gamma"]) {
			if (value !== "") expect(report).not.toContain(value);
		}
	});
});

describe("makePgResealStore", () => {
	const calls: { text: string; params: readonly unknown[] | undefined }[] = [];
	const respond = (rows: Record<string, unknown>[]) => ({
		query: async (text: string, params?: readonly unknown[]) => {
			calls.push({ text, params });
			return { rows };
		},
	});

	beforeEach(() => {
		calls.length = 0;
	});

	it("reads unsealed rows with keyset pagination on the text form of the primary key", async () => {
		const { reseal } = await fresh();
		const store = reseal.makePgResealStore(respond([{ id: "a", value: "x:y:z:w" }]));

		const rows = await store.readUnsealed(target, "prev", 50);

		expect(rows).toEqual([{ id: "a", value: "x:y:z:w" }]);
		expect(calls[0]?.params).toEqual(["prev", 50]);
		expect(calls[0]?.text).toBe(
			`SELECT "id"::text AS id, "token" AS value FROM "secrets" ` +
				`WHERE "token" IS NOT NULL AND "token" <> '' AND "token" NOT LIKE 'enc:v1:%' ` +
				`AND ($1::text IS NULL OR "id"::text > $1::text) ORDER BY "id"::text LIMIT $2`,
		);
	});

	it("replaces with a compare-and-set on the value that was read", async () => {
		const { reseal } = await fresh();
		const won = reseal.makePgResealStore(respond([{ ok: 1 }]));
		const lost = reseal.makePgResealStore(respond([]));

		expect(await won.replace(target, "7", "old", "new")).toBe(true);
		expect(await lost.replace(target, "7", "old", "new")).toBe(false);
		expect(calls[0]?.params).toEqual(["new", "7", "old"]);
		expect(calls[0]?.text).toBe(
			`UPDATE "secrets" SET "token" = $1 WHERE "id"::text = $2 AND "token" = $3 RETURNING 1 AS ok`,
		);
	});

	it("counts unsealed rows and qualifies the table with its SQL schema, quoting identifiers", async () => {
		const { reseal } = await fresh();
		const store = reseal.makePgResealStore(respond([{ n: 3 }]));

		const n = await store.countUnsealed({ schema: "app", table: 'we"ird', column: "c", primaryKey: "id" });

		expect(n).toBe(3);
		expect(calls[0]?.text).toContain('FROM "app"."we""ird"');
	});
});
