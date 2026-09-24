import { Logger } from "@nestjs/common";
import { validateApiEnvPath } from "@repo/env";
import { scryptSync } from "crypto";
import {
	configureSchemaCodecs,
	type EncryptedTextKeyProvider,
	type TraefikConfigCodec,
} from "@repo/nest-schema/codecs/codec-registry";
import { TraefikConfigBuilder } from "@/core/modules/traefik/config-builder/builders";

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
 * Resolve the 32-byte AES-256 key from `AUTH_SECRET`.
 *
 * Validated through the shared env schema so a malformed secret fails with the
 * schema's message rather than a cryptic crypto error later.
 */
const encryptionKeyProvider: EncryptedTextKeyProvider = {
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
		encryption: encryptionKeyProvider,
		traefik: traefikConfigCodec,
	});
}
