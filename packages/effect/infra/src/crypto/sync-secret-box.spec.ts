import { Effect, Layer, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { KeyRing } from "./key-ring";
import { isLegacyCiphertext, LegacyFormatInvalid, readLegacyCiphertext } from "./legacy-ciphertext";
import { isSealedText, parseSealedText, SEALED_PREFIX } from "./sealed-text";
import { SecretBox } from "./secret-box";
import { COLUMN_CODEC_AAD, makeSyncSecretBox } from "./sync-secret-box";

const ROOT = "kJ8vQ2mP9xLr4TnB7yHs5WcZ1dGfA3eU6iO0pNqMvXbY=";
const make = (generations?: Parameters<typeof makeSyncSecretBox>[0]["generations"]) =>
  makeSyncSecretBox({ rootSecret: Redacted.make(ROOT), ...(generations === undefined ? {} : { generations }) });

const thrownTag = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { _tag?: string })._tag;
  }
  return undefined;
};

/** Known-answer vectors produced by running the OLD codec algorithm (scrypt per value, AES-256-GCM) with fixed salt/iv. */
const LEGACY_VECTORS = [
  {
    name: "hex secret, connection string",
    keyHex: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    plaintext: "postgres://user:pa55@db.internal:5432/app",
    stored:
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20:a0a1a2a3a4a5a6a7a8a9aaabacadaeaf:b126cdeeb7a8772c8534a2de0c1343b6:56291568c05b0478a1986d9b6ea7a4f534b49cf629d8a8127f184f9ea9424b2ef99fc0ee21abb7ef01",
  },
  {
    name: "hex secret, unicode",
    keyHex: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    plaintext: "héllo-✓-密钥",
    stored:
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20:a0a1a2a3a4a5a6a7a8a9aaabacadaeaf:1da8e4dc4818f4e073604eca42c09d66:4e85cf70cb464ce907246f0bb2443f5de1",
  },
  {
    name: "base64 AUTH_SECRET parsed as hex (EMPTY key)",
    keyHex: "",
    plaintext: "ghp_exampletoken0123456789",
    stored:
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20:a0a1a2a3a4a5a6a7a8a9aaabacadaeaf:39e83b1c589dfc83ad3d4e1b40f904db:c0527eb9446be08bc3e0eef114d3ee10ce1229851b4f9331c298",
  },
  {
    name: "dev fallback key",
    keyHex: "4a082ba7a669ee6b66d0a3d196cb4a5eb002e278f150946c054f427a25ae456f",
    plaintext: "dev-credential",
    stored:
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20:a0a1a2a3a4a5a6a7a8a9aaabacadaeaf:ecf6ef4fb9c098153ffa2b8f215b418a:be33527bcc099a0fccdf7b5c46f7",
  },
] as const;

describe("readLegacyCiphertext (rows written by the old codec stay readable)", () => {
  it.each(LEGACY_VECTORS)("reads the known-answer vector: $name", ({ keyHex, plaintext, stored }) => {
    expect(isLegacyCiphertext(stored)).toBe(true);
    expect(readLegacyCiphertext(stored, Buffer.from(keyHex, "hex"))).toBe(plaintext);
  });

  it("documents SEC-016: a base64 AUTH_SECRET gave an EMPTY key, so the 'encrypted' value opens with no secret at all", () => {
    expect(Buffer.from(ROOT, "hex").length).toBe(0);
    const emptyKey = LEGACY_VECTORS[2];
    expect(readLegacyCiphertext(emptyKey.stored, new Uint8Array(0))).toBe(emptyKey.plaintext);
  });

  it("fails with OpenFailed for a wrong key and for tampering", () => {
    const [vector] = LEGACY_VECTORS;
    expect(thrownTag(() => readLegacyCiphertext(vector.stored, Buffer.alloc(32, 1)))).toBe("OpenFailed");
    const parts = vector.stored.split(":");
    parts[3] = `${parts[3]?.slice(0, -2) ?? ""}00`;
    expect(thrownTag(() => readLegacyCiphertext(parts.join(":"), Buffer.from(vector.keyHex, "hex")))).toBe("OpenFailed");
  });

  it("rejects values that are not in the legacy shape", () => {
    expect(thrownTag(() => readLegacyCiphertext("plaintext-secret", Buffer.alloc(0)))).toBe("LegacyFormatInvalid");
    expect(thrownTag(() => readLegacyCiphertext("a:b:c", Buffer.alloc(0)))).toBe("LegacyFormatInvalid");
    expect(new LegacyFormatInvalid({ message: "x" })._tag).toBe("LegacyFormatInvalid");
  });

  it("never confuses the two formats", () => {
    const sealed = make().seal("v");
    expect(isSealedText(sealed)).toBe(true);
    expect(isLegacyCiphertext(sealed)).toBe(false);
    expect(isSealedText(LEGACY_VECTORS[0].stored)).toBe(false);
  });
});

describe("makeSyncSecretBox", () => {
  it("round-trips and stores the self-describing sealed form", () => {
    const box = make();
    const stored = box.seal("s3cret-é✓");
    expect(stored.startsWith(SEALED_PREFIX)).toBe(true);
    expect(stored).not.toContain("s3cret");
    expect(parseSealedText(stored)).toMatchObject({ v: 1, kid: "column:1" });
    expect(box.open(stored)).toBe("s3cret-é✓");
  });

  it("uses a fresh nonce per seal", () => {
    const box = make();
    expect(box.seal("same")).not.toBe(box.seal("same"));
  });

  it("refuses a weak, short or placeholder root unless the insecure fallback is explicit", () => {
    for (const root of ["short", "a".repeat(64), "fallback-auth-secret-fallback-auth-secret", "dev-fallback-key-0123456789abcdefghijklmn"]) {
      expect(thrownTag(() => makeSyncSecretBox({ rootSecret: Redacted.make(root) }))).toBe("WeakRootSecret");
    }
    expect(() => makeSyncSecretBox({ rootSecret: Redacted.make("short"), allowInsecureRoot: true })).not.toThrow();
  });

  it("rejects inconsistent generations", () => {
    expect(thrownTag(() => make({ column: { current: 3, accepted: [1, 2] } }))).toBe("KeyRingConfigInvalid");
  });

  it("refuses a tampered value, a wrong key and a malformed value", () => {
    const box = make();
    const stored = box.seal("secret");
    const parsed = parseSealedText(stored);
    expect(parsed).toBeDefined();
    const tampered = `${SEALED_PREFIX}${JSON.stringify({ ...parsed, ct: `A${parsed?.ct.slice(1) ?? ""}` })}`;
    expect(thrownTag(() => box.open(tampered))).toBe("OpenFailed");
    const other = makeSyncSecretBox({ rootSecret: Redacted.make("another-totally-different-root-0123456789zz") });
    expect(thrownTag(() => other.open(stored))).toBe("OpenFailed");
    expect(thrownTag(() => box.open(`${SEALED_PREFIX}not json`))).toBe("OpenFailed");
    expect(thrownTag(() => box.open("plain"))).toBe("OpenFailed");
  });

  it("binds the AAD (a value sealed for one place does not open for another)", () => {
    const box = make();
    const stored = box.seal("secret", { table: "t", column: "c", rowId: "1" });
    expect(box.open(stored, { table: "t", column: "c", rowId: "1" })).toBe("secret");
    expect(thrownTag(() => box.open(stored, { table: "t", column: "c", rowId: "2" }))).toBe("OpenFailed");
    expect(thrownTag(() => box.open(stored))).toBe("OpenFailed"); // codec AAD differs from the row AAD
    expect(thrownTag(() => box.seal("x", { table: "", column: "c", rowId: "1" }))).toBe("SealError");
  });

  it("rotates by generation: old values open while accepted, then retire", () => {
    const v1 = make({ column: { current: 1, accepted: [1] } }).seal("secret");
    const rotated = make({ column: { current: 2, accepted: [1, 2] } });
    expect(rotated.open(v1)).toBe("secret");
    const resealed = rotated.seal(rotated.open(v1));
    expect(parseSealedText(resealed)?.kid).toBe("column:2");
    const retired = make({ column: { current: 2, accepted: [2] } });
    expect(thrownTag(() => retired.open(v1))).toBe("UnknownKeyId");
    expect(retired.open(resealed)).toBe("secret");
  });
});

describe("sync/async interop (one design, two implementations)", () => {
  const asyncBox = SecretBox.layer.pipe(Layer.provide(KeyRing.layer({ rootSecret: Redacted.make(ROOT) })));
  const withAsyncBox = <A, E>(program: Effect.Effect<A, E, SecretBox>) => Effect.runPromise(program.pipe(Effect.provide(asyncBox)));

  it("a value sealed synchronously is opened by the async SecretBox", async () => {
    const stored = make().seal("from-sync", COLUMN_CODEC_AAD);
    const box = parseSealedText(stored);
    expect(box).toBeDefined();
    const opened = await withAsyncBox(
      Effect.gen(function* () {
        return yield* (yield* SecretBox).open(box!, COLUMN_CODEC_AAD);
      }),
    );
    expect(Redacted.value(opened)).toBe("from-sync");
  });

  it("a value sealed by the async SecretBox is opened synchronously", async () => {
    const sealed = await withAsyncBox(
      Effect.gen(function* () {
        return yield* (yield* SecretBox).seal(Redacted.make("from-async"), COLUMN_CODEC_AAD);
      }),
    );
    expect(make().open(`${SEALED_PREFIX}${JSON.stringify(sealed)}`)).toBe("from-async");
  });
});
