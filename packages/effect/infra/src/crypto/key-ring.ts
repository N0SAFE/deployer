import { fromAbortable } from "@deployer/effect-core";
import { Context, Effect, Layer, Redacted } from "effect";

import { KeyRingConfigInvalid, UnknownKeyId, WeakRootSecret, type KeyUnavailable } from "./errors";

export const KEY_PURPOSES = ["column", "claim", "session", "ingress", "backup"] as const;
export type KeyPurpose = (typeof KEY_PURPOSES)[number];

/** `<purpose>:<generation>`, for example `column:1`. Stable, unique per purpose. */
export type KeyId = string & { readonly __brand: "KeyId" };

export type KeyHandle = {
  readonly kid: KeyId;
  readonly purpose: KeyPurpose;
  readonly cryptoKey: CryptoKey;
};

export type KeyGenerations = {
  /** The generation new data is sealed with. */
  readonly current: number;
  /** Generations that may still be opened (always includes `current`). Retire one by dropping it. */
  readonly accepted: readonly number[];
};

export type KeyRingConfig = {
  /** ONE root secret; per-purpose, per-generation keys are HKDF-derived from it (SEC-018). */
  readonly rootSecret: Redacted.Redacted;
  /** Defaults to `{ current: 1, accepted: [1] }` for every purpose. */
  readonly generations?: Partial<Record<KeyPurpose, KeyGenerations>>;
};

export type KeyRingShape = {
  readonly current: (purpose: KeyPurpose) => Effect.Effect<KeyHandle, KeyUnavailable>;
  readonly byId: (kid: string) => Effect.Effect<KeyHandle, UnknownKeyId>;
};

const MIN_ROOT_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARS = 8;
/** Placeholders that have shipped in `.env.example` / compose defaults at some point. */
const PLACEHOLDER = /fallback|change-?me|dev-?(fallback|secret|key)|example|secret-?here|password|default/i;

const encoder = new TextEncoder();
export const HKDF_SALT = encoder.encode("deployer/key-ring/v1");

export const formatKid = (purpose: KeyPurpose, generation: number): KeyId =>
  `${purpose}:${String(generation)}` as KeyId;

const parseKid = (kid: string): { purpose: KeyPurpose; generation: number } | undefined => {
  const separator = kid.lastIndexOf(":");
  if (separator < 1) return undefined;
  const purpose = kid.slice(0, separator);
  const generationText = kid.slice(separator + 1);
  if (!/^[1-9]\d{0,8}$/.test(generationText)) return undefined;
  if (!(KEY_PURPOSES as readonly string[]).includes(purpose)) return undefined;
  return { purpose: purpose as KeyPurpose, generation: Number(generationText) };
};

export const validateRootSecret = (secret: string): string | undefined => {
  if (secret.length < MIN_ROOT_SECRET_LENGTH) {
    return `root secret must be at least ${String(MIN_ROOT_SECRET_LENGTH)} characters (got ${String(secret.length)})`;
  }
  if (new Set(secret).size < MIN_DISTINCT_CHARS) {
    return "root secret has too little variety to be random";
  }
  if (PLACEHOLDER.test(secret)) {
    return "root secret looks like a placeholder/default value";
  }
  return undefined;
};

export const validateGenerations = (
  purpose: KeyPurpose,
  generations: KeyGenerations,
): string | undefined => {
  const all = [generations.current, ...generations.accepted];
  if (!all.every((g) => Number.isInteger(g) && g >= 1 && g <= 999_999_999)) {
    return `${purpose}: generations must be positive integers`;
  }
  if (!generations.accepted.includes(generations.current)) {
    return `${purpose}: current generation ${String(generations.current)} must be in accepted`;
  }
  return undefined;
};

/**
 * Key ring: key ids, HKDF-derived per-purpose keys, rotation by generation.
 *
 * Replaces the singleton codec registry and the per-value `scryptSync` of a single
 * `AUTH_SECRET` that is parsed as hex (a base64 secret silently yields a 0-byte
 * key: SEC-016). Rotation is a config change (bump `current`, keep the old
 * generation in `accepted`, reseal, then drop it); a table-backed ring with an
 * online `rotate` is a follow-up that implements the same `KeyRingShape`.
 */
export class KeyRing extends Context.Service<KeyRing, KeyRingShape>()("infra/KeyRing") {
  /**
   * Config-driven ring. Fails construction with `WeakRootSecret` / `KeyRingConfigInvalid`
   * (a service must not boot with a placeholder key), and derives every accepted
   * key up front so crypto problems surface at boot, not on first request.
   */
  static readonly layer = (
    config: KeyRingConfig,
  ): Layer.Layer<KeyRing, WeakRootSecret | KeyRingConfigInvalid> =>
    Layer.effect(
      KeyRing,
      Effect.gen(function* () {
        const root = Redacted.value(config.rootSecret);
        const weak = validateRootSecret(root);
        if (weak !== undefined) return yield* new WeakRootSecret({ message: weak });

        const generations = new Map<KeyPurpose, KeyGenerations>();
        for (const purpose of KEY_PURPOSES) {
          const configured = config.generations?.[purpose] ?? { current: 1, accepted: [1] };
          const invalid = validateGenerations(purpose, configured);
          if (invalid !== undefined) return yield* new KeyRingConfigInvalid({ message: invalid });
          generations.set(purpose, configured);
        }

        // Defect on a crypto-layer failure: WebCrypto does not fail for valid input.
        const base = yield* fromAbortable(
          () => crypto.subtle.importKey("raw", encoder.encode(root), "HKDF", false, ["deriveKey"]),
          (cause) => cause,
        ).pipe(Effect.orDie);

        const handles = new Map<string, KeyHandle>();
        for (const [purpose, gens] of generations) {
          for (const generation of new Set(gens.accepted)) {
            const kid = formatKid(purpose, generation);
            const cryptoKey = yield* fromAbortable(
              () =>
                crypto.subtle.deriveKey(
                  { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: encoder.encode(kid) },
                  base,
                  { name: "AES-GCM", length: 256 },
                  false,
                  ["encrypt", "decrypt"],
                ),
              (cause) => cause,
            ).pipe(Effect.orDie);
            handles.set(kid, { kid, purpose, cryptoKey });
          }
        }

        return KeyRing.of({
          current: (purpose) => {
            const gens = generations.get(purpose);
            // `gens` and its handle exist for every purpose by construction.
            const handle = gens === undefined ? undefined : handles.get(formatKid(purpose, gens.current));
            return handle === undefined ? Effect.die(new Error(`key ring missing ${purpose}`)) : Effect.succeed(handle);
          },
          byId: (kid) => {
            const parsed = parseKid(kid);
            const handle = parsed === undefined ? undefined : handles.get(formatKid(parsed.purpose, parsed.generation));
            return handle === undefined ? Effect.fail(new UnknownKeyId({ kid })) : Effect.succeed(handle);
          },
        });
      }),
    );

  /** Test layer: a fixed, valid ring so specs never depend on environment variables. */
  static readonly test = (
    generations?: KeyRingConfig["generations"],
  ): Layer.Layer<KeyRing> =>
    KeyRing.layer({
      rootSecret: Redacted.make("test-only-root-secret-0123456789abcdef"),
      ...(generations === undefined ? {} : { generations }),
    }).pipe(Layer.orDie);
}
