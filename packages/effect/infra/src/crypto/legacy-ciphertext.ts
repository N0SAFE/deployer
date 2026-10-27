import { createDecipheriv, scryptSync } from "node:crypto";

import { Data } from "effect";

import { OpenFailed } from "./errors";
import { isSealedText } from "./sealed-text";

/** The stored value does not have the legacy `salt:iv:tag:data` shape. */
export class LegacyFormatInvalid extends Data.TaggedError("LegacyFormatInvalid")<{
  readonly message: string;
}> {}

const KEY_LENGTH = 32;

/**
 * True for the pre-`SecretBox` format: four `:`-separated hex segments, `salt:iv:authTag:data`.
 * A sealed value starts with `enc:`, so the two can never be confused.
 */
export const isLegacyCiphertext = (stored: string): boolean => !isSealedText(stored) && stored.split(":").length === 4;

/**
 * Read a value written by the old codec: `scrypt(key, salt, 32)` per value, AES-256-GCM, a
 * 16-byte IV, no key id and no AAD. `key` is whatever the old key provider returned
 * (`Buffer.from(AUTH_SECRET, "hex")`, which is EMPTY for a non-hex secret: such rows used a
 * publicly derivable key, and are exactly what the reseal sweep exists to fix).
 *
 * READ-ONLY by design: nothing in this package can produce this format. It is retired when
 * the reseal sweep reports zero legacy rows (EFF-272).
 *
 * Throws `LegacyFormatInvalid` (shape) or `OpenFailed` (wrong key or tampered).
 */
export const readLegacyCiphertext = (stored: string, key: Uint8Array): string => {
  const parts = stored.split(":");
  const [saltHex, ivHex, authTagHex, data] = parts;
  if (parts.length !== 4 || saltHex === undefined || ivHex === undefined || authTagHex === undefined || data === undefined) {
    throw new LegacyFormatInvalid({ message: "Invalid encrypted data format" });
  }
  try {
    const derived = scryptSync(key, Buffer.from(saltHex, "hex"), KEY_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", derived, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return decipher.update(data, "hex", "utf8") + decipher.final("utf8");
  } catch {
    throw new OpenFailed({ kid: "legacy" });
  }
};
