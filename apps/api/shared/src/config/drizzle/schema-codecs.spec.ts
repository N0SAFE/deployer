import { createCipheriv, randomBytes, scryptSync } from "node:crypto";

import {
	configureSchemaCodecs,
	decryptSecret,
	encryptSecret,
	isSealedValue,
} from "@deployer/nest-schema/codecs/codec-registry";
import { findEncryptedColumns } from "@deployer/nest-schema/codecs/reseal";
import * as globalSchema from "@deployer/nest-schema/global";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerSchemaCodecs, resolveSealer } from "./schema-codecs";

/**
 * The key policy for NEW writes (SEC-016) and the compatibility contract with rows the old
 * codec wrote. Runs under the Bun runtime (the sealer uses `Uint8Array#toBase64`).
 */

const STRONG = "kJ8vQ2mP9xLr4TnB7yHs5WcZ1dGfA3eU6iO0pNqMvXbY=";
const OTHER_STRONG = "Zr5tYw8Qe1Lk3Vb7Nc9Xs2Pd4Gh6Jf0AaMoIuTyRbEn=";
const HEX_SECRET = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

/** The OLD writer, verbatim: scrypt(key, randomSalt) + AES-256-GCM, `salt:iv:tag:data`. */
function oldEncrypt(text: string, key: Buffer): string {
	const salt = randomBytes(32);
	const iv = randomBytes(16);
	const cipher = createCipheriv("aes-256-gcm", scryptSync(key, salt, 32), iv);
	let encrypted = cipher.update(text, "utf8", "hex");
	encrypted += cipher.final("hex");
	return `${salt.toString("hex")}:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted}`;
}

describe("resolveSealer: the root-secret policy", () => {
	it("round-trips with a strong AUTH_SECRET in production (base64 is fine: no hex assumption)", () => {
		const sealer = resolveSealer({ NODE_ENV: "production", AUTH_SECRET: STRONG });
		const stored = sealer.seal("token");
		expect(stored.startsWith("enc:v1:")).toBe(true);
		expect(sealer.open(stored)).toBe("token");
	});

	it("prefers DEPLOYER_ROOT_SECRET over AUTH_SECRET", () => {
		const viaRoot = resolveSealer({ NODE_ENV: "production", DEPLOYER_ROOT_SECRET: STRONG, AUTH_SECRET: OTHER_STRONG });
		const viaAuth = resolveSealer({ NODE_ENV: "production", AUTH_SECRET: OTHER_STRONG });
		const viaRootOnly = resolveSealer({ NODE_ENV: "production", DEPLOYER_ROOT_SECRET: STRONG });

		const stored = viaRoot.seal("secret");
		expect(viaRootOnly.open(stored)).toBe("secret");
		expect(() => viaAuth.open(stored)).toThrow();
	});

	it("refuses to boot in production without any secret", () => {
		expect(() => resolveSealer({ NODE_ENV: "production" })).toThrowError(/DEPLOYER_ROOT_SECRET.*refusing to boot/);
		expect(() => resolveSealer({ NODE_ENV: "production", DEPLOYER_ROOT_SECRET: "   " })).toThrowError(/refusing to boot/);
	});

	it.each([
		["too short", "short"],
		["a placeholder", "your-secure-auth-secret-here-0123456789abcdef"],
		["a known fallback", "fallback-auth-secret-fallback-auth-secret"],
		["no variety", "a".repeat(64)],
	])("refuses to boot in production with a root that is %s, naming the variable to set", (_label, secret) => {
		expect(() => resolveSealer({ NODE_ENV: "production", AUTH_SECRET: secret })).toThrowError(
			/DEPLOYER_ROOT_SECRET.*refusing to boot/s,
		);
	});

	it("outside production a missing or weak root falls back (with a warning) so dev and tests keep working", () => {
		for (const env of [{ NODE_ENV: "development" }, { NODE_ENV: "test", AUTH_SECRET: "short" }, {}]) {
			const sealer = resolveSealer(env);
			expect(sealer.open(sealer.seal("dev-value"))).toBe("dev-value");
		}
	});

	it("the dev fallback root is stable across restarts (dev data stays readable)", () => {
		const first = resolveSealer({ NODE_ENV: "development" }).seal("persisted");
		expect(resolveSealer({ NODE_ENV: "development" }).open(first)).toBe("persisted");
	});
});

describe("registerSchemaCodecs: compatibility with rows written by the old codec", () => {
	beforeEach(() => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("AUTH_SECRET", HEX_SECRET);
		vi.stubEnv("DEPLOYER_ROOT_SECRET", STRONG);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		// Leave the module-level registry in a harmless state for other suites in this worker.
		configureSchemaCodecs({ encryption: { resolveKey: () => Buffer.alloc(32, 7) } });
	});

	it("reads legacy rows (key = AUTH_SECRET as hex) and writes only the sealed form", () => {
		const legacyRow = oldEncrypt("old-github-private-key", Buffer.from(HEX_SECRET, "hex"));

		registerSchemaCodecs();

		expect(isSealedValue(legacyRow)).toBe(false);
		expect(decryptSecret(legacyRow)).toBe("old-github-private-key");
		const fresh = encryptSecret("new-github-private-key");
		expect(isSealedValue(fresh)).toBe(true);
		expect(fresh).not.toContain("new-github");
		expect(decryptSecret(fresh)).toBe("new-github-private-key");
	});

	it("reads rows that were written under an EMPTY key (non-hex AUTH_SECRET), the SEC-016 case", () => {
		vi.stubEnv("AUTH_SECRET", STRONG); // base64: parsed as hex it is empty
		const legacyRow = oldEncrypt("exposed-dns-token", Buffer.from(STRONG, "hex"));
		expect(Buffer.from(STRONG, "hex").length).toBe(0);

		registerSchemaCodecs();

		expect(decryptSecret(legacyRow)).toBe("exposed-dns-token");
	});

	it("registerSchemaCodecs fails at boot (not at first query) when production has a weak root", () => {
		vi.stubEnv("DEPLOYER_ROOT_SECRET", "");
		vi.stubEnv("AUTH_SECRET", "short");

		expect(() => { registerSchemaCodecs(); }).toThrowError(/refusing to boot/);
	});
});

describe("the REAL schema's encrypted columns use the registry that registerSchemaCodecs configures", () => {
	/**
	 * Regression guard. When `nest-schema`'s built chunks imported the registry through the
	 * package's own name, Bun resolved that specifier to the SOURCE file (via the package's
	 * tsconfig `paths`) while consumers got the DIST file: two copies of the module-level
	 * registry, one configured and one not. Every real column then threw "used before the
	 * encryption key was configured". Tables built inside a spec cannot catch that; the real
	 * schema can.
	 */
	beforeEach(() => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("AUTH_SECRET", HEX_SECRET);
		vi.stubEnv("DEPLOYER_ROOT_SECRET", STRONG);
		registerSchemaCodecs();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		configureSchemaCodecs({ encryption: { resolveKey: () => Buffer.alloc(32, 7) } });
	});

	it("finds the encrypted columns, so none is bound to an unconfigured copy of the registry", () => {
		const { targets, skipped } = findEncryptedColumns(globalSchema);

		expect(skipped).toEqual([]);
		// 11 at the time of writing; the point is "all of them", not the exact count.
		expect(targets.length).toBeGreaterThanOrEqual(11);
		expect(targets.map((t) => `${t.table}.${t.column}`)).toEqual(
			expect.arrayContaining(["environment_variables.value", "dns_providers.credentials", "github_apps.private_key", "webhooks.secret"]),
		);
	});
});
