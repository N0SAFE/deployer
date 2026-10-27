import { Data } from "effect";

/** The configured root secret is too short, low-entropy, or a known placeholder. Fails layer construction. */
export class WeakRootSecret extends Data.TaggedError("WeakRootSecret")<{
  readonly message: string;
}> {}

/** The key-ring generation configuration is inconsistent (for example `current` is not in `accepted`). */
export class KeyRingConfigInvalid extends Data.TaggedError("KeyRingConfigInvalid")<{
  readonly message: string;
}> {}

/** No usable key for this purpose (never produced by the config-driven ring; reserved for table-backed rings). */
export class KeyUnavailable extends Data.TaggedError("KeyUnavailable")<{
  readonly purpose: string;
}> {}

/** The key id is not accepted by this ring (never existed, or its generation was retired). */
export class UnknownKeyId extends Data.TaggedError("UnknownKeyId")<{
  readonly kid: string;
}> {}

/** Encryption failed (invalid AAD or a crypto-layer failure). */
export class SealError extends Data.TaggedError("SealError")<{
  readonly message: string;
}> {}

/**
 * Decryption failed. AES-GCM cannot distinguish a wrong AAD (ciphertext moved to
 * another row/column) from tampering or a wrong key, so there is exactly one error.
 */
export class OpenFailed extends Data.TaggedError("OpenFailed")<{
  readonly kid: string;
}> {}
