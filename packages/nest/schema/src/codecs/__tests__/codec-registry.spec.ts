import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * The codec registry is the ONE seam where the app supplies behaviour the
 * schema needs (the encryption key, the traefik builder). Three properties make
 * it worth testing rather than trusting:
 *
 *   1. It is DEFERRED — the codecs run at QUERY time, not definition time, so a
 *      column may be declared at module scope while its key arrives at boot.
 *   2. A codec used before configuration must FAIL LOUDLY, naming the exact call
 *      to add — never silently write plaintext into an encrypted column.
 *   3. The traefik direction is FAULT-ISOLATED — a corrupt row must not crash a
 *      SELECT, and a bad value must not abort a write.
 *
 * The registry is module-level state with no public reset (correctly: production
 * code configures it once at boot). Tests therefore reset it via `vi.resetModules`
 * and re-import, so every case starts from a genuinely unconfigured registry
 * instead of inheriting a sibling test's setup.
 */

type CodecModule = typeof import("../codec-registry");

const KEY_A = Buffer.from("a".repeat(64), "hex");
const KEY_B = Buffer.from("b".repeat(64), "hex");

/** A fresh, unconfigured module instance — the state a cold boot sees. */
async function freshModule(): Promise<CodecModule> {
	vi.resetModules();
	return await import("../codec-registry");
}

/** A module with encryption configured. */
async function moduleWithKey(key = KEY_A): Promise<CodecModule> {
	const mod = await freshModule();
	mod.configureEncryption({ resolveKey: () => key });
	return mod;
}

/** A minimal stand-in for the app's traefik builder. */
interface FakeBuilder {
	routes: { rule: string }[];
}

function fakeTraefikCodec() {
	return {
		load: (value: string | object): FakeBuilder =>
			typeof value === "string" ? (JSON.parse(value) as FakeBuilder) : (value as FakeBuilder),
		empty: (): FakeBuilder => ({ routes: [] }),
		build: (builder: FakeBuilder): object => builder,
	};
}

beforeEach(() => {
	vi.resetModules();
});

describe("encryptedText — round trip", () => {
	it("round-trips a plaintext value through encrypt/decrypt", async () => {
		const { encryptSecret, decryptSecret } = await moduleWithKey();
		const plaintext = "super-secret-password";

		const stored = encryptSecret(plaintext);
		expect(stored).not.toBe(plaintext);
		expect(decryptSecret(stored)).toBe(plaintext);
	});

	it("round-trips empty and unicode values", async () => {
		const { encryptSecret, decryptSecret } = await moduleWithKey();
		for (const value of ["", "héllo wörld — 日本語 🔐"]) {
			expect(decryptSecret(encryptSecret(value))).toBe(value);
		}
	});

	it("short-circuits empty values instead of encrypting them", async () => {
		const { encryptSecret, decryptSecret } = await moduleWithKey();
		expect(encryptSecret("")).toBe("");
		expect(decryptSecret("")).toBe("");
	});

	it("uses a per-value salt, so equal plaintexts produce different ciphertexts", async () => {
		const { encryptSecret } = await moduleWithKey();
		const a = encryptSecret("same-value");
		const b = encryptSecret("same-value");

		expect(a).not.toBe(b);
		const partsA = a.split(":");
		const partsB = b.split(":");
		// salt:iv:authTag:ciphertext
		expect(partsA).toHaveLength(4);
		expect(partsA[0]).not.toBe(partsB[0]);
	});

	it("rejects a tampered ciphertext (the GCM auth tag is verified)", async () => {
		const { encryptSecret, decryptSecret } = await moduleWithKey();
		const parts = encryptSecret("tamper-me").split(":");

		// Flip the ciphertext, keep salt/iv/authTag — decryption must fail.
		const tampered = [parts[0], parts[1], parts[2], `${parts[3]!.slice(0, -2)}ff`].join(":");
		expect(() => decryptSecret(tampered)).toThrowError(/Failed to decrypt/);
	});

	it("rejects a payload with the wrong number of segments", async () => {
		const { decryptSecret } = await moduleWithKey();
		expect(() => decryptSecret("not-a-valid-payload")).toThrowError(/Invalid encrypted data/);
	});

	it("fails to decrypt when the key differs from the one used to encrypt", async () => {
		const encryptor = await moduleWithKey(KEY_A);
		const stored = encryptor.encryptSecret("cross-key-value");

		const decryptor = await moduleWithKey(KEY_B);
		expect(() => decryptor.decryptSecret(stored)).toThrowError(/Failed to decrypt/);
	});
});

describe("encryptedText — fail-fast when unconfigured", () => {
	it("refuses to encrypt rather than storing plaintext", async () => {
		const { encryptSecret } = await freshModule();

		expect(() => encryptSecret("plaintext-must-not-land-on-disk")).toThrowError(
			/configureSchemaCodecs/,
		);
	});

	it("preserves the SCHEMA_CODEC_NOT_CONFIGURED code through the error wrapper", async () => {
		const { encryptSecret } = await freshModule();

		// The boot-order error must survive the blanket catch: its message is the
		// only thing telling an operator which call to add.
		expect(() => encryptSecret("x")).toThrowError(
			expect.objectContaining({ code: "SCHEMA_CODEC_NOT_CONFIGURED" }),
		);
	});

	it("propagates the fail-fast error on the decrypt path too", async () => {
		const { decryptSecret } = await freshModule();

		expect(() => decryptSecret("aaaa:bbbb:cccc:dddd")).toThrowError(
			expect.objectContaining({ code: "SCHEMA_CODEC_NOT_CONFIGURED" }),
		);
	});
});

describe("the column delegates to the exported codec", () => {
	it("encrypts at QUERY time, through the real drizzle write path", async () => {
		const { encryptedText, decryptSecret } = await moduleWithKey();
		const table = pgTable("codec_probe", {
			id: text("id").primaryKey(),
			secret: encryptedText("secret"),
		});

		// `drizzle.mock()` builds the real SQL + params without a connection, so
		// this asserts the codec is invoked where it actually runs — at query
		// time — rather than at column-definition time.
		const { params } = drizzle.mock()
			.insert(table)
			.values({ id: "1", secret: "column-vs-function" })
			.toSQL();

		const stored = params[1];
		expect(typeof stored).toBe("string");
		expect(stored).not.toBe("column-vs-function");
		// The function can read what the column wrote — the property provisioning
		// scripts rely on when they write through raw SQL.
		expect(decryptSecret(stored as string)).toBe("column-vs-function");
	});

	it("degrades on an unconfigured codec at query time (never writes plaintext)", async () => {
		const { encryptedText } = await freshModule();
		const table = pgTable("codec_probe", {
			id: text("id").primaryKey(),
			secret: encryptedText("secret"),
		});

		expect(() =>
			drizzle.mock().insert(table).values({ id: "1", secret: "must-not-be-plain" }).toSQL(),
		).toThrowError(/configureSchemaCodecs/);
	});
});

describe("traefikConfigBuilder — delegates to the app's codec", () => {
	const builder: FakeBuilder = { routes: [{ rule: "Host(`api.example`)" }] };

	it("round-trips a builder through the registered codec", async () => {
		const mod = await freshModule();
		mod.configureTraefikConfigCodec(fakeTraefikCodec());

		expect(mod.readTraefikConfig<FakeBuilder>(JSON.stringify(builder))).toEqual(builder);
	});

	it("returns the codec's empty value for a blank column", async () => {
		const mod = await freshModule();
		mod.configureTraefikConfigCodec(fakeTraefikCodec());

		expect(mod.readTraefikConfig<FakeBuilder>("")).toEqual({ routes: [] });
	});

	it("degrades to the empty config on a corrupt row instead of failing the SELECT", async () => {
		const mod = await freshModule();
		mod.configureTraefikConfigCodec(fakeTraefikCodec());

		expect(mod.readTraefikConfig<FakeBuilder>("{ this is not json")).toEqual({ routes: [] });
	});

	it("degrades to an empty JSON object when the codec rejects a value on write", async () => {
		const mod = await freshModule();
		mod.configureTraefikConfigCodec({
			load: () => ({ routes: [] }),
			empty: () => ({ routes: [] }),
			build: () => {
				throw new Error("builder rejected the value");
			},
		});
		const table = pgTable("traefik_probe", {
			id: text("id").primaryKey(),
			config: mod.traefikConfigBuilder("config"),
		});

		const { params } = drizzle.mock()
			.insert(table)
			.values({ id: "1", config: { routes: [] } })
			.toSQL();

		expect(params[1]).toBe("{}");
	});

	it("throws for a read against an unconfigured traefik codec", async () => {
		const mod = await freshModule();
		expect(() => mod.readTraefikConfig<FakeBuilder>("{}")).toThrowError(/configureSchemaCodecs/);
	});
});

describe("configureSchemaCodecs", () => {
	it("configures only the codecs that were supplied", async () => {
		const mod = await freshModule();
		mod.configureSchemaCodecs({ encryption: { resolveKey: () => KEY_A } });

		// Encryption is live…
		expect(mod.encryptSecret("x")).not.toBe("x");
		// …while traefik was left untouched, so it still fails loudly.
		expect(() => mod.readTraefikConfig<FakeBuilder>("{}")).toThrow();
	});

	it("configures both codecs in one call", async () => {
		const mod = await freshModule();
		mod.configureSchemaCodecs({
			encryption: { resolveKey: () => KEY_A },
			traefik: fakeTraefikCodec(),
		});

		expect(mod.encryptSecret("x")).not.toBe("x");
		expect(mod.readTraefikConfig<FakeBuilder>('{"routes":[{"rule":"x"}]}')).toEqual({
			routes: [{ rule: "x" }],
		});
	});
});

describe("generateEncryptionKey", () => {
	it("generates 32 bytes of hex key material", async () => {
		const { generateEncryptionKey } = await freshModule();
		expect(generateEncryptionKey()).toMatch(/^[0-9a-f]{64}$/);
	});

	it("generates a different key each call", async () => {
		const { generateEncryptionKey } = await freshModule();
		expect(generateEncryptionKey()).not.toBe(generateEncryptionKey());
	});

	it("produces a key usable by the codec round trip", async () => {
		const mod = await freshModule();
		// The provider must return a STABLE key: encryption and decryption both
		// call it, so a provider generating fresh material per call cannot
		// round-trip. Deriving it once mirrors how the app supplies the key.
		const generated = Buffer.from(mod.generateEncryptionKey(), "hex");
		mod.configureEncryption({ resolveKey: () => generated });

		expect(mod.decryptSecret(mod.encryptSecret("generated-key-value"))).toBe(
			"generated-key-value",
		);
	});

	it("a per-call key provider cannot round-trip (documents the contract)", async () => {
		const mod = await freshModule();
		mod.configureEncryption({
			resolveKey: () => Buffer.from(mod.generateEncryptionKey(), "hex"),
		});

		// The key provider is called on BOTH directions, so a provider that mints
		// new material each time produces undecryptable ciphertext. Asserting this
		// keeps the contract explicit rather than leaving it as a silent trap.
		expect(() => mod.decryptSecret(mod.encryptSecret("value"))).toThrowError(/Failed to decrypt/);
	});
});
