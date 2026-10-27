import { isBox, type SealedBox } from "./secret-box";

/**
 * A sealed value stored in a TEXT column: `enc:v1:` + the JSON of a `SealedBox`.
 *
 * Self-describing (key id and nonce travel with the data) and unambiguous next to the
 * legacy format (`salt:iv:tag:data`, four hex segments, which can never start with `enc:`).
 * The async `SecretBox` and the synchronous column codec both read and write it, so a
 * value written by one is opened by the other.
 */
export const SEALED_PREFIX = "enc:v1:";

export const isSealedText = (stored: string): boolean => stored.startsWith(SEALED_PREFIX);

export const sealedToText = (box: SealedBox): string => `${SEALED_PREFIX}${JSON.stringify(box)}`;

/** `undefined` when the text is not a well-formed sealed value (never throws). */
export const parseSealedText = (stored: string): SealedBox | undefined => {
  if (!isSealedText(stored)) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored.slice(SEALED_PREFIX.length));
    return isBox(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};
