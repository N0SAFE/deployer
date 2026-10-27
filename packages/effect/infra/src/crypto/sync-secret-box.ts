import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { Redacted } from "effect";

import { KeyRingConfigInvalid, OpenFailed, SealError, UnknownKeyId, WeakRootSecret } from "./errors";
import {
  formatKid,
  HKDF_SALT,
  KEY_PURPOSES,
  validateGenerations,
  validateRootSecret,
  type KeyGenerations,
  type KeyPurpose,
  type KeyRingConfig,
} from "./key-ring";
import { parseSealedText, sealedToText } from "./sealed-text";
import { b64, encodeAad, NONCE_BYTES, TAG_BYTES, unb64, validAad, type Aad } from "./secret-box";

/**
 * The AAD of the column codec. A drizzle column codec runs per VALUE and cannot see which
 * table, column or row it serves, so it can only bind the purpose. Row binding comes with
 * explicit `seal`/`open` in repositories (DEC-EFF-19, the end state).
 */
export const COLUMN_CODEC_AAD: Aad = { table: "*", column: "*", rowId: "*" };

export type SyncSecretBoxOptions = KeyRingConfig & {
  /**
   * Skip the weak/placeholder root check. For non-production fallbacks ONLY: the caller is
   * responsible for refusing to use this in production.
   */
  readonly allowInsecureRoot?: boolean;
};

export type SyncSecretBox = {
  /** Returns the value to store (`enc:v1:{...}`). Throws `SealError` for an invalid AAD. */
  readonly seal: (plaintext: string, aad?: Aad, options?: { readonly purpose?: KeyPurpose }) => string;
  /** Throws `OpenFailed` (wrong key/AAD/tampered/malformed) or `UnknownKeyId` (retired generation). */
  readonly open: (stored: string, aad?: Aad) => string;
};

const encoder = new TextEncoder();

/**
 * Synchronous twin of `KeyRing` + `SecretBox`, for the one place that cannot be async: drizzle
 * column codecs (`customType` `toDriver`/`fromDriver` are synchronous, WebCrypto is async-only,
 * and Bun ships no synchronous AES builtin).
 *
 * It is deliberately NOT a second design: the key derivation (HKDF-SHA256, same salt, `kid` as
 * info), the key ids, the AAD encoding and the stored form are shared with the async layer, and
 * the specs prove the two interoperate in both directions. This is the only module in the
 * package that uses `node:crypto`; it goes away when repositories use `SecretBox` directly.
 *
 * Throws (it cannot return an Effect): `WeakRootSecret`, `KeyRingConfigInvalid` on construction.
 */
export const makeSyncSecretBox = (options: SyncSecretBoxOptions): SyncSecretBox => {
  const root = Redacted.value(options.rootSecret);
  if (options.allowInsecureRoot !== true) {
    const weak = validateRootSecret(root);
    if (weak !== undefined) throw new WeakRootSecret({ message: weak });
  }

  const generations = new Map<KeyPurpose, KeyGenerations>();
  for (const purpose of KEY_PURPOSES) {
    const configured = options.generations?.[purpose] ?? { current: 1, accepted: [1] };
    const invalid = validateGenerations(purpose, configured);
    if (invalid !== undefined) throw new KeyRingConfigInvalid({ message: invalid });
    generations.set(purpose, configured);
  }

  const rootBytes = encoder.encode(root);
  const keys = new Map<string, Buffer>();
  for (const [purpose, gens] of generations) {
    for (const generation of new Set(gens.accepted)) {
      const kid = formatKid(purpose, generation);
      keys.set(kid, Buffer.from(hkdfSync("sha256", rootBytes, HKDF_SALT, encoder.encode(kid), 32)));
    }
  }

  const seal: SyncSecretBox["seal"] = (plaintext, aad = COLUMN_CODEC_AAD, sealOptions) => {
    if (!validAad(aad)) throw new SealError({ message: "aad.table, aad.column and aad.rowId are required" });
    const purpose = sealOptions?.purpose ?? "column";
    const current = generations.get(purpose)?.current;
    const kid = current === undefined ? undefined : formatKid(purpose, current);
    const key = kid === undefined ? undefined : keys.get(kid);
    if (kid === undefined || key === undefined) throw new SealError({ message: `no current key for ${purpose}` });

    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(encodeAad(kid, aad));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    // Same layout as WebCrypto AES-GCM: ciphertext followed by the 16-byte tag.
    const ct = Buffer.concat([body, cipher.getAuthTag()]);
    return sealedToText({
      v: 1,
      kid,
      nonce: b64(nonce),
      ct: b64(ct),
    });
  };

  const open: SyncSecretBox["open"] = (stored, aad = COLUMN_CODEC_AAD) => {
    const box = parseSealedText(stored);
    if (box === undefined || !validAad(aad)) throw new OpenFailed({ kid: box?.kid ?? "" });
    const key = keys.get(box.kid);
    if (key === undefined) throw new UnknownKeyId({ kid: box.kid });
    try {
      const nonce = unb64(box.nonce);
      const ct = unb64(box.ct);
      if (nonce === undefined || ct === undefined || nonce.length !== NONCE_BYTES || ct.length < TAG_BYTES) {
        throw new OpenFailed({ kid: box.kid });
      }
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(encodeAad(box.kid, aad));
      decipher.setAuthTag(Buffer.from(ct.subarray(ct.length - TAG_BYTES)));
      return Buffer.concat([decipher.update(ct.subarray(0, ct.length - TAG_BYTES)), decipher.final()]).toString("utf8");
    } catch {
      // GCM cannot tell a wrong AAD from tampering or a wrong key: one error, no detail.
      throw new OpenFailed({ kid: box.kid });
    }
  };

  return { seal, open };
};
