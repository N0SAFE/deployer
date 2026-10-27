import { Logger } from "@nestjs/common";
import { AppError } from "@deployer/errors";
import { customType } from "drizzle-orm/pg-core";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const logger = new Logger("SchemaCodecs");

/**
 * Deferred codec registry — how the APP supplies behaviour the schema needs.
 *
 * WHY DEFERRED, AND WHY THIS IS THE RIGHT SEAM
 * A drizzle column's `fromDriver` / `toDriver` run at QUERY time, not at
 * definition time. That is what lets a table definition be a plain module-level
 * constant while its behaviour is configured at BOOT — so the schema package can
 * ship `encryptedText('secret')` without owning the key policy, and the app can
 * keep its production fail-fast without the package knowing about it.
 *
 * The alternative — turning every table into a factory function — would churn
 * 27 schema files and every consumer, for no behavioural gain.
 *
 * FAIL-FAST, NOT FAIL-SILENT: using a codec before the app configures it is a
 * programming error (boot order), so it throws with the exact call to add rather
 * than silently writing plaintext into an encrypted column.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/**
 * Supplies the LEGACY encryption key. The app decides where it comes from.
 *
 * Since the sealing codec was introduced this is the READ path for old rows only
 * (`salt:iv:tag:data`); new writes go through {@link EncryptedTextSealer}.
 */
export type EncryptedTextKeyProvider = {
	resolveKey(): Buffer;
}

/**
 * Seals and opens values in the current stored form (`enc:v1:{...}`: key id, nonce and
 * ciphertext, AES-256-GCM under an HKDF-derived key). Supplied by the app so this package
 * never owns key material; it only knows the prefix, to route a stored value to the right
 * reader.
 */
export type EncryptedTextSealer = {
	seal(plaintext: string): string;
	open(stored: string): string;
}

/** Prefix of a value written by a sealer. A legacy value (`salt:iv:tag:data`, hex) never starts with it. */
export const SEALED_VALUE_PREFIX = "enc:v1:";

/** True when `stored` is in the current (sealed) form rather than the legacy one. */
export function isSealedValue(stored: string): boolean {
	return stored.startsWith(SEALED_VALUE_PREFIX);
}

/** The minimal builder contract the traefik column needs. Supplied by the app. */
export type TraefikConfigCodec<TBuilder> = {
	load(value: string | object): TBuilder;
	empty(): TBuilder;
	build(builder: TBuilder): object;
}

type Registry = {
	/** Legacy key: used to READ old rows. Never used to write once `sealing` is configured. */
	encryption?: EncryptedTextKeyProvider;
	/** Current codec: used for every write, and for every read of a sealed value. */
	sealing?: EncryptedTextSealer;
	/** Erased form: the registry is heterogeneous, reads re-apply the type. */
	traefik?: TraefikConfigCodec<unknown>;
}

const registry: Registry = {};

/** Configure the encryption key. Call once at boot, before the first query. */
export function configureEncryption(provider: EncryptedTextKeyProvider): void {
	registry.encryption = provider;
}

/** Configure the sealing codec. Call once at boot, before the first query. */
export function configureSealing(sealer: EncryptedTextSealer): void {
	registry.sealing = sealer;
}

/**
 * Configure the traefik config codec. Call once at boot, before the first query.
 *
 * The parameter is the app's TYPED codec; the registry stores it erased. That
 * single widening happens here, at the one place where the app hands its type
 * over — every read afterwards is generic and recovers it, so no call site
 * needs an assertion.
 */
export function configureTraefikConfigCodec<TBuilder>(codec: TraefikConfigCodec<TBuilder>): void {
	registry.traefik = codec;
}

/** Configure everything the schema needs, in one call. */
export function configureSchemaCodecs(config: Registry): void {
	if (config.encryption !== undefined) configureEncryption(config.encryption);
	if (config.sealing !== undefined) configureSealing(config.sealing);
	if (config.traefik !== undefined) configureTraefikConfigCodec(config.traefik);
}

function requireEncryption(): EncryptedTextKeyProvider {
	if (registry.encryption === undefined) {
		throw new AppError(
			"encryptedText column used before the encryption key was configured — " +
				"call configureSchemaCodecs({ encryption }) at boot",
			"SCHEMA_CODEC_NOT_CONFIGURED",
		);
	}
	return registry.encryption;
}

/**
 * Encrypt a secret for storage.
 *
 * Exported (rather than kept private to the column) so the on-disk format has
 * a directly testable surface: the column is a thin adapter over this, and a
 * format change must fail a test rather than silently produce unreadable rows.
 *
 * A per-value random salt means two rows with the same plaintext do not produce
 * the same ciphertext.
 *
 * An empty value is returned unchanged (there is nothing to conceal), so a NULL/
 * blank column never acquires a ciphertext wrapper.
 */
export function encryptSecret(text: string): string {
	if (!text) return text;
	try {
		// The current form. Only when no sealer is configured (the frozen monolith) does a
		// write fall back to the legacy form below.
		if (registry.sealing !== undefined) return registry.sealing.seal(text);

		const key = requireEncryption().resolveKey();
		const salt = randomBytes(SALT_LENGTH);
		const derived = scryptSync(key, salt, KEY_LENGTH);
		const iv = randomBytes(IV_LENGTH);

		const cipher = createCipheriv(ALGORITHM, derived, iv);
		let encrypted = cipher.update(text, "utf8", "hex");
		encrypted += cipher.final("hex");

		return `${salt.toString("hex")}:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted}`;
	} catch (error) {
		// Preserve the deliberate boot-order error, which names the call to add;
		// only an UNEXPECTED failure is rewrapped as a generic encrypt error.
		if (error instanceof AppError) throw error;
		logger.error("Encryption error:", { error });
		throw new AppError("Failed to encrypt data", "ENCRYPTION_ERROR");
	}
}

/** The four hex segments of a stored ciphertext. */
type EncryptedPayload = {
	saltHex: string;
	ivHex: string;
	authTagHex: string;
	encryptedData: string;
}

/**
 * Split a stored payload into its parts, validating the shape.
 *
 * Each field is checked individually rather than trusting a length count, so a
 * truncated or over-long value is rejected at the same place the type is
 * established — no assertion is needed to narrow the tuple.
 */
function parseEncryptedPayload(payload: string): EncryptedPayload {
	const parts = payload.split(":");
	const [saltHex, ivHex, authTagHex, encryptedData] = parts;

	if (
		parts.length !== 4 ||
		saltHex === undefined ||
		ivHex === undefined ||
		authTagHex === undefined ||
		encryptedData === undefined
	) {
		throw new AppError("Invalid encrypted data format", "ENCRYPTION_ERROR");
	}

	return { saltHex, ivHex, authTagHex, encryptedData };
}

/**
 * Decrypt a stored secret. Exported alongside {@link encryptSecret} so the
 * on-disk format has one implementation and one test surface.
 *
 * An empty value is returned unchanged, mirroring {@link encryptSecret}.
 */
export function decryptSecret(payload: string): string {
	if (!payload) return payload;
	try {
		// A sealed value is routed to the sealer; everything else is the legacy form.
		if (isSealedValue(payload)) {
			if (registry.sealing === undefined) {
				throw new AppError(
					"sealed value read before the sealing codec was configured — " +
						"call configureSchemaCodecs({ sealing }) at boot",
					"SCHEMA_CODEC_NOT_CONFIGURED",
				);
			}
			return registry.sealing.open(payload);
		}

		const { saltHex, ivHex, authTagHex, encryptedData } = parseEncryptedPayload(payload);

		const salt = Buffer.from(saltHex, "hex");
		const derived = scryptSync(requireEncryption().resolveKey(), salt, KEY_LENGTH);
		const decipher = createDecipheriv(ALGORITHM, derived, Buffer.from(ivHex, "hex"));
		decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

		return decipher.update(encryptedData, "hex", "utf8") + decipher.final("utf8");
	} catch (error) {
		// Preserve the deliberate AppErrors: a boot-order error names the call to
		// add, and a malformed payload says it is malformed. Only an UNEXPECTED
		// failure (crypto/encoding) is rewrapped as a generic decrypt error.
		if (error instanceof AppError) throw error;
		logger.error("Decryption error:", { error });
		throw new AppError("Failed to decrypt data", "ENCRYPTION_ERROR");
	}
}

/**
 * Encrypt-at-rest text column. The key comes from the app via
 * `configureSchemaCodecs`, so this package never reads an env var or decides
 * whether a missing key is fatal — that is application policy.
 */
export const encryptedText = customType<{
	data: string;
	driverData: string;
	notNull: boolean;
	default: false;
}>({
	dataType() {
		return "text";
	},
	fromDriver(value: string): string {
		return decryptSecret(value);
	},
	toDriver(value: string): string {
		return encryptSecret(value);
	},
});

/**
 * JSONB column holding the app's traefik config builder. The builder comes from
 * the app via `configureSchemaCodecs`, so this package does not depend on a
 * feature module.
 *
 * Both directions are fault-isolated: a corrupt row must not crash a SELECT, and
 * a bad value must not abort a write. Failures degrade to an empty config.
 */
export const traefikConfigBuilder = customType<{
	data: unknown;
	driverData: string;
	notNull: boolean;
	default: false;
}>({
	dataType() {
		return "jsonb";
	},
	fromDriver(value: string): unknown {
		return readTraefikConfig<unknown>(value);
	},
	toDriver(value: unknown): string {
		return writeTraefikConfig(value);
	},
});

/**
 * Deserialize a stored traefik config through the app's registered codec.
 *
 * Generic over the builder so the caller — a column typed to the app's builder
 * — receives the real type instead of `unknown`. No assertion needed: the
 * app's codec is what produced the value.
 *
 * Fault-isolated: a corrupt row must not crash a SELECT, so failures log and
 * degrade to an empty config — the behaviour the app relied on before.
 */
export function readTraefikConfig<TBuilder>(value: string): TBuilder {
	const codec = requireTraefik<TBuilder>();
	if (!value) return codec.empty();
	try {
		return codec.load(value);
	} catch (error) {
		logger.error("Failed to deserialize traefik config from database", { error });
		return codec.empty();
	}
}

/** Serialize a traefik config through the app's registered codec. */
function writeTraefikConfig(value: unknown): string {
	try {
		return JSON.stringify(requireTraefik<unknown>().build(value));
	} catch (error) {
		logger.error("Failed to serialize traefik config to database", { error });
		return JSON.stringify({});
	}
}


function requireTraefik<TBuilder>(): TraefikConfigCodec<TBuilder> {
	const codec = registry.traefik;
	if (codec === undefined) {
		throw new AppError(
			"traefikConfigBuilder column used before the codec was configured — " +
				"call configureSchemaCodecs({ traefik }) at boot",
			"SCHEMA_CODEC_NOT_CONFIGURED",
		);
	}
	// The registry is erased by construction: it holds whatever the app
	// registered, and this generic is the caller's claim about its own builder.
	return codec as TraefikConfigCodec<TBuilder>;
}

/** Generate 32 bytes of key material as hex — for provisioning a new secret. */
export function generateEncryptionKey(): string {
	return randomBytes(32).toString("hex");
}
