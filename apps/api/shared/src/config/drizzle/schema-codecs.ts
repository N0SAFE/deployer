import { Logger } from "@nestjs/common";
import { validateApiEnvPath } from "@deployer/env";
import { makeSyncSecretBox } from "@deployer/effect-infra";
import { Redacted } from "effect";
import { scryptSync } from "crypto";
import {
	configureSchemaCodecs,
	type EncryptedTextKeyProvider,
	type EncryptedTextSealer,
	type TraefikConfigCodec,
} from "@deployer/nest-schema/codecs/codec-registry";
import { TraefikConfigBuilder } from "../../core/modules/traefik/config-builder/builders";

const logger = new Logger("SchemaCodecs");



/**
 * The APP half of the schema codecs: where the encryption key comes from, and
 * which traefik builder the config column uses.
 *
 * WHY THIS LIVES IN THE APP
 * Both answers are application POLICY, not schema mechanics. The key policy in
 * particular is security-sensitive: a missing `AUTH_SECRET` is a HARD BOOT
 * FAILURE in production (an in-source fallback key would make every stored
 * ciphertext decryptable by anyone with repo access) but a loud warning in
 * dev/test, where a temporary key keeps unit runs working. A shared schema
 * package cannot make that call — it does not know which environment it is in.
 *
 * The package declares what it needs; this file is what it gets.
 */

/**
 * LEGACY key: used ONLY to read rows written before the sealing codec existed
 * (`salt:iv:tag:data`). Nothing is written with it any more.
 *
 * It is deliberately left byte-for-byte as it was, including its flaw: the key is
 * `Buffer.from(AUTH_SECRET, "hex")`, which is EMPTY for a non-hex secret (SEC-016). Old
 * rows must stay readable exactly as they were written; the reseal command rewrites them
 * under the real key, and this provider is deleted once it reports zero legacy rows.
 *
 * Validated through the shared env schema so a malformed secret fails with the
 * schema's message rather than a cryptic crypto error later.
 */
const legacyKeyProvider: EncryptedTextKeyProvider = {
	resolveKey(): Buffer {
		// `AUTH_SECRET` is OPTIONAL in the shared env schema, so the validated
		// value can legitimately be undefined — that is the "not configured"
		// case the fallback below handles, not an invariant to assert.
		const secret = process.env.AUTH_SECRET
			? validateApiEnvPath(process.env.AUTH_SECRET, "AUTH_SECRET")
			: undefined;
		if (secret !== undefined && secret !== "") {
			return Buffer.from(secret, "hex");
		}

		// Fail fast: never run production with an in-source fallback key — any
		// ciphertext written under it is trivially decryptable.
		if (process.env.NODE_ENV === "production") {
			throw new Error("Encryption key (AUTH_SECRET) is required in production — refusing to boot");
		}

		logger.warn(
			"⚠️  AUTH_SECRET not found. PRODUCTION WILL REFUSE TO BOOT — this shows because " +
				"non-production environments (dev/test) use a temporary key, which is NOT secure. " +
				'Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
		);
		return scryptSync("temporary-fallback-key", "salt", 32);
	},
};

/** Root used when NO secret is configured outside production. It is public: never a real key. */
const INSECURE_DEV_ROOT = "insecure-dev-root-secret-never-use-in-production";

/** The slice of the environment the sealer policy reads. */
export type SealerEnv = {
	readonly DEPLOYER_ROOT_SECRET?: string | undefined;
	readonly AUTH_SECRET?: string | undefined;
	readonly NODE_ENV?: string | undefined;
};

/**
 * Build the sealing codec: the policy for the key that protects NEW writes (SEC-016).
 *
 * Root = `DEPLOYER_ROOT_SECRET`, falling back to `AUTH_SECRET`. Production REFUSES to boot
 * when the root is missing, shorter than 32 characters, low-variety or a placeholder: a
 * weak root silently re-creates the original bug. Outside production a missing or weak root
 * falls back to a public dev root with a loud warning, so local runs and unit tests keep
 * working (a random per-process key would make dev data unreadable after a restart).
 */
export function resolveSealer(env: SealerEnv): EncryptedTextSealer {
	const configured = env.DEPLOYER_ROOT_SECRET?.trim() || env.AUTH_SECRET?.trim() || undefined;
	const production = env.NODE_ENV === "production";
	const fix = "Set DEPLOYER_ROOT_SECRET to at least 32 random characters (for example `openssl rand -base64 48`)";

	if (configured === undefined) {
		if (production) {
			throw new Error(`Encryption root secret is required in production: ${fix} — refusing to boot`);
		}
		logger.warn("⚠️  No DEPLOYER_ROOT_SECRET/AUTH_SECRET: using a PUBLIC dev root. Production will refuse to boot.");
		return sealerFor(INSECURE_DEV_ROOT, true);
	}

	try {
		return sealerFor(configured, false);
	} catch (error) {
		if ((error as { _tag?: string })._tag !== "WeakRootSecret") throw error;
		const reason = error instanceof Error ? error.message : "weak secret";
		if (production) {
			throw new Error(`Encryption root secret rejected (${reason}). ${fix} — refusing to boot`);
		}
		logger.warn(`⚠️  Encryption root secret is weak (${reason}); allowed outside production only.`);
		return sealerFor(configured, true);
	}
}

function sealerFor(root: string, allowInsecureRoot: boolean): EncryptedTextSealer {
	const box = makeSyncSecretBox({ rootSecret: Redacted.make(root), allowInsecureRoot });
	return { seal: (plaintext) => box.seal(plaintext), open: (stored) => box.open(stored) };
}

/**
 * The traefik config builder, as the schema's `jsonb` column needs it.
 *
 * `load` accepts both a stored JSON string and an already-parsed object, which
 * is what the column receives depending on the driver path.
 */
const traefikConfigCodec: TraefikConfigCodec<TraefikConfigBuilder> = {
	// `load` accepts a stored JSON string OR an already-parsed object, which is
	// what the column receives depending on the driver path.
	load: (value: string | object) =>
		TraefikConfigBuilder.load(typeof value === "string" ? value : JSON.stringify(value)),
	empty: () => new TraefikConfigBuilder(),
	build: (builder: TraefikConfigBuilder) => builder.build(),
};

/**
 * Wire the schema codecs. MUST run before the first query touches an encrypted
 * or traefik-config column; the package throws a named error if it does not.
 */
export function registerSchemaCodecs(): void {
	configureSchemaCodecs({
		// Reads of rows written by the old codec.
		encryption: legacyKeyProvider,
		// Every write, and every read of a sealed value. Built eagerly so a weak root fails at boot.
		sealing: resolveSealer(process.env),
		traefik: traefikConfigCodec,
	});
}
