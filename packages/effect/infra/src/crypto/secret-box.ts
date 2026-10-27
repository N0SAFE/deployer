import { fromAbortable } from "@deployer/effect-core";
import { Context, Effect, Layer, Redacted } from "effect";

import { OpenFailed, SealError, type UnknownKeyId } from "./errors";
import { KeyRing, type KeyPurpose } from "./key-ring";

/**
 * Additional authenticated data. It binds a ciphertext to WHERE it lives: a value
 * copied to another table, column, row or scope fails to open (row-swap defence).
 */
export type Aad = {
  readonly table: string;
  readonly column: string;
  readonly rowId: string;
  readonly scope?: string;
};

/** The persisted form. All binary fields are base64url. Safe to store as JSON. */
export type SealedBox = {
  readonly v: 1;
  readonly kid: string;
  readonly nonce: string;
  readonly ct: string;
};

export type SecretBoxShape = {
  readonly seal: (
    plaintext: Redacted.Redacted,
    aad: Aad,
    options?: { readonly purpose?: KeyPurpose },
  ) => Effect.Effect<SealedBox, SealError>;
  readonly open: (
    box: SealedBox,
    aad: Aad,
  ) => Effect.Effect<Redacted.Redacted, OpenFailed | UnknownKeyId>;
  /** Re-encrypt under the current generation (the rotation sweep). */
  readonly reseal: (
    box: SealedBox,
    aad: Aad,
    options?: { readonly purpose?: KeyPurpose },
  ) => Effect.Effect<SealedBox, OpenFailed | UnknownKeyId | SealError>;
};

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * base64url via the Bun builtins (`Uint8Array#toBase64` / `Uint8Array.fromBase64`). The `Buffer`
 * fallback exists only for packages whose test scripts still run vitest on Node, where those
 * methods do not exist yet; under Bun the builtin is always used.
 */
export const b64 = (bytes: Uint8Array): string =>
  typeof bytes.toBase64 === "function"
    ? bytes.toBase64({ alphabet: "base64url", omitPadding: true })
    : Buffer.from(bytes).toString("base64url");

/** `undefined` for malformed input (a tampered box must fail as `OpenFailed`, never throw). */
export const unb64 = (text: string): Uint8Array<ArrayBuffer> | undefined => {
  try {
    if (typeof Uint8Array.fromBase64 === "function") {
      return Uint8Array.fromBase64(text, { alphabet: "base64url" });
    }
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return undefined;
    return new Uint8Array(Buffer.from(text, "base64url"));
  } catch {
    return undefined;
  }
};

export const validAad = (aad: Aad): boolean =>
  aad.table.length > 0 && aad.column.length > 0 && aad.rowId.length > 0;

/** Canonical, unambiguous AAD bytes: a JSON array (no key-order or delimiter ambiguity). */
export const encodeAad = (kid: string, aad: Aad): Uint8Array<ArrayBuffer> =>
  encoder.encode(JSON.stringify([1, kid, aad.table, aad.column, aad.rowId, aad.scope ?? ""]));

export const isBox = (box: unknown): box is SealedBox => {
  if (typeof box !== "object" || box === null) return false;
  const candidate = box as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    typeof candidate.kid === "string" &&
    typeof candidate.nonce === "string" &&
    typeof candidate.ct === "string"
  );
};

/**
 * Authenticated encryption at rest (AES-256-GCM) with key ids, AAD binding and
 * rotation. `Redacted.value` is unwrapped only inside `seal`; `open` returns a
 * `Redacted` so a decrypted secret cannot be logged by accident.
 *
 * Explicit seal/open in repository mappers replaces the global codec registry
 * (no `configureEncryption()` boot-order trap) - DEC-EFF-19.
 */
export class SecretBox extends Context.Service<SecretBox, SecretBoxShape>()("infra/SecretBox") {
  static readonly layer: Layer.Layer<SecretBox, never, KeyRing> = Layer.effect(
    SecretBox,
    Effect.gen(function* () {
      const ring = yield* KeyRing;

      const seal: SecretBoxShape["seal"] = (plaintext, aad, options) =>
        Effect.gen(function* () {
          if (!validAad(aad)) {
            return yield* new SealError({ message: "aad.table, aad.column and aad.rowId are required" });
          }
          // A ring without a current key for this purpose is a boot-time defect (see KeyRing.layer).
          const key = yield* ring.current(options?.purpose ?? "column").pipe(Effect.orDie);
          const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
          const ciphertext = yield* fromAbortable(
            () =>
              crypto.subtle.encrypt(
                { name: "AES-GCM", iv: nonce, additionalData: encodeAad(key.kid, aad) },
                key.cryptoKey,
                encoder.encode(Redacted.value(plaintext)),
              ),
            () => new SealError({ message: "encryption failed" }),
          );
          return { v: 1, kid: key.kid, nonce: b64(nonce), ct: b64(new Uint8Array(ciphertext)) } as const;
        });

      const open: SecretBoxShape["open"] = (box, aad) =>
        Effect.gen(function* () {
          const kid = isBox(box) ? box.kid : "";
          if (!isBox(box) || !validAad(aad)) return yield* new OpenFailed({ kid });
          const key = yield* ring.byId(box.kid);
          const nonce = unb64(box.nonce);
          const ct = unb64(box.ct);
          if (nonce === undefined || ct === undefined || nonce.length !== NONCE_BYTES || ct.length < TAG_BYTES) {
            return yield* new OpenFailed({ kid: box.kid });
          }
          const plaintext = yield* fromAbortable(
            () =>
              crypto.subtle.decrypt(
                { name: "AES-GCM", iv: nonce, additionalData: encodeAad(box.kid, aad) },
                key.cryptoKey,
                ct,
              ),
            () => new OpenFailed({ kid: box.kid }),
          );
          return yield* Effect.try({
            try: () => Redacted.make(decoder.decode(new Uint8Array(plaintext))),
            catch: () => new OpenFailed({ kid: box.kid }),
          });
        });

      const reseal: SecretBoxShape["reseal"] = (box, aad, options) =>
        open(box, aad).pipe(Effect.flatMap((plaintext) => seal(plaintext, aad, options)));

      return SecretBox.of({ seal, open, reseal });
    }),
  );

  /**
   * Test layer that does NOT encrypt (ciphertext is the plaintext in base64url) but
   * enforces the same AAD contract, so repository specs that do not care about
   * crypto stay fast and still catch a wrong table/column/row. Never use outside tests.
   */
  static readonly insecureTest: Layer.Layer<SecretBox> = Layer.sync(SecretBox, () => {
    const seal: SecretBoxShape["seal"] = (plaintext, aad) =>
      validAad(aad)
        ? Effect.succeed({
            v: 1,
            kid: "insecure:0",
            nonce: b64(new Uint8Array(NONCE_BYTES)),
            ct: b64(
              encoder.encode(
                JSON.stringify([aad.table, aad.column, aad.rowId, aad.scope ?? "", Redacted.value(plaintext)]),
              ),
            ),
          } as const)
        : Effect.fail(new SealError({ message: "aad.table, aad.column and aad.rowId are required" }));
    const open: SecretBoxShape["open"] = (box, aad) =>
      Effect.try({
        try: () => {
          const [table, column, rowId, scope, value] = JSON.parse(decoder.decode(unb64(box.ct))) as [
            string,
            string,
            string,
            string,
            string,
          ];
          if (table !== aad.table || column !== aad.column || rowId !== aad.rowId || scope !== (aad.scope ?? "")) {
            throw new Error("aad mismatch");
          }
          return Redacted.make(value);
        },
        catch: () => new OpenFailed({ kid: box.kid }),
      });
    const reseal: SecretBoxShape["reseal"] = (box, aad, options) =>
      open(box, aad).pipe(Effect.flatMap((plaintext) => seal(plaintext, aad, options)));
    return SecretBox.of({ seal, open, reseal });
  });
}
