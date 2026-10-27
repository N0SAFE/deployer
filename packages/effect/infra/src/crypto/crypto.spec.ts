import { Effect, Exit, Layer, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { KeyRing } from "./key-ring";
import { SecretBox, type Aad, type SealedBox } from "./secret-box";

const aad: Aad = { table: "service_env", column: "value", rowId: "row-1", scope: "svc-1" };
const secret = Redacted.make("postgres://user:hunter2@db/prod");

const boxLayer = (generations?: Parameters<typeof KeyRing.test>[0]) =>
  SecretBox.layer.pipe(Layer.provide(KeyRing.test(generations)));

const run = <A, E>(effect: Effect.Effect<A, E, SecretBox>, generations?: Parameters<typeof KeyRing.test>[0]) =>
  Effect.runPromise(effect.pipe(Effect.provide(boxLayer(generations))));

const runExit = <A, E>(effect: Effect.Effect<A, E, SecretBox>, generations?: Parameters<typeof KeyRing.test>[0]) =>
  Effect.runPromiseExit(effect.pipe(Effect.provide(boxLayer(generations))));

const failureTag = <A, E>(exit: Exit.Exit<A, E>): string | undefined => {
  if (!Exit.isFailure(exit)) return undefined;
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail");
  return error === undefined ? undefined : (error.error as { _tag?: string })._tag;
};

describe("SecretBox", () => {
  it("round-trips a secret and returns it Redacted", async () => {
    const opened = await run(
      Effect.gen(function* () {
        const box = yield* SecretBox;
        const sealed = yield* box.seal(secret, aad);
        return yield* box.open(sealed, aad);
      }),
    );
    expect(Redacted.value(opened)).toBe("postgres://user:hunter2@db/prod");
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- asserting that Redacted#toString hides the value
    expect(String(opened)).not.toContain("hunter2");
    expect(JSON.stringify(opened)).not.toContain("hunter2");
  });

  it("never stores the plaintext and uses a fresh nonce per seal", async () => {
    const [a, b] = await run(
      Effect.gen(function* () {
        const box = yield* SecretBox;
        return [yield* box.seal(secret, aad), yield* box.seal(secret, aad)] as const;
      }),
    );
    expect(JSON.stringify(a)).not.toContain("hunter2");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ct).not.toBe(b.ct);
    expect(a.kid).toBe("column:1");
  });

  it.each([
    ["another row", { ...aad, rowId: "row-2" }],
    ["another column", { ...aad, column: "other" }],
    ["another table", { ...aad, table: "users" }],
    ["another scope", { ...aad, scope: "svc-2" }],
    ["no scope", { table: aad.table, column: aad.column, rowId: aad.rowId }],
  ])("refuses a ciphertext moved to %s (row-swap defence)", async (_label, other) => {
    const exit = await runExit(
      Effect.gen(function* () {
        const box = yield* SecretBox;
        const sealed = yield* box.seal(secret, aad);
        return yield* box.open(sealed, other);
      }),
    );
    expect(failureTag(exit)).toBe("OpenFailed");
  });

  it("refuses tampered ciphertext, nonce, key id and version", async () => {
    const tamper = async (mutate: (b: SealedBox) => unknown) => {
      const exit = await runExit(
        Effect.gen(function* () {
          const box = yield* SecretBox;
          const sealed = yield* box.seal(secret, aad);
          return yield* box.open(mutate(sealed) as SealedBox, aad);
        }),
      );
      return failureTag(exit);
    };
    const flip = (text: string) => (text.startsWith("A") ? `B${text.slice(1)}` : `A${text.slice(1)}`);
    expect(await tamper((b) => ({ ...b, ct: flip(b.ct) }))).toBe("OpenFailed");
    expect(await tamper((b) => ({ ...b, nonce: flip(b.nonce) }))).toBe("OpenFailed");
    expect(await tamper((b) => ({ ...b, nonce: "AAAA" }))).toBe("OpenFailed");
    expect(await tamper((b) => ({ ...b, ct: "AAAA" }))).toBe("OpenFailed");
    expect(await tamper((b) => ({ ...b, v: 2 }))).toBe("OpenFailed");
    expect(await tamper(() => ({ nothing: true }))).toBe("OpenFailed");
    expect(await tamper((b) => ({ ...b, kid: "column:7" }))).toBe("UnknownKeyId");
    expect(await tamper((b) => ({ ...b, kid: "evil" }))).toBe("UnknownKeyId");
  });

  it("rejects an AAD with an empty required field", async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const box = yield* SecretBox;
        return yield* box.seal(secret, { ...aad, rowId: "" });
      }),
    );
    expect(failureTag(exit)).toBe("SealError");
  });

  it("separates purposes: a column box does not open under another purpose's key id", async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const box = yield* SecretBox;
        const sealed = yield* box.seal(secret, aad, { purpose: "backup" });
        expect(sealed.kid).toBe("backup:1");
        return yield* box.open({ ...sealed, kid: "column:1" }, aad);
      }),
    );
    expect(failureTag(exit)).toBe("OpenFailed");
  });

  it("rotates: old generation opens while accepted, reseal moves to the current one, then retires", async () => {
    const sealedUnderV1 = await run(
      Effect.gen(function* () {
        return yield* (yield* SecretBox).seal(secret, aad);
      }),
      { column: { current: 1, accepted: [1] } },
    );
    expect(sealedUnderV1.kid).toBe("column:1");

    const resealed = await run(
      Effect.gen(function* () {
        const box = yield* SecretBox;
        const opened = yield* box.open(sealedUnderV1, aad);
        expect(Redacted.value(opened)).toBe("postgres://user:hunter2@db/prod");
        return yield* box.reseal(sealedUnderV1, aad);
      }),
      { column: { current: 2, accepted: [1, 2] } },
    );
    expect(resealed.kid).toBe("column:2");

    const afterRetire = await runExit(
      Effect.gen(function* () {
        return yield* (yield* SecretBox).open(sealedUnderV1, aad);
      }),
      { column: { current: 2, accepted: [2] } },
    );
    expect(failureTag(afterRetire)).toBe("UnknownKeyId");

    const stillOpens = await run(
      Effect.gen(function* () {
        return yield* (yield* SecretBox).open(resealed, aad);
      }),
      { column: { current: 2, accepted: [2] } },
    );
    expect(Redacted.value(stillOpens)).toBe("postgres://user:hunter2@db/prod");
  });

  it("insecureTest layer still enforces the AAD contract", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const box = yield* SecretBox;
        const sealed = yield* box.seal(secret, aad);
        const ok = yield* box.open(sealed, aad);
        expect(Redacted.value(ok)).toContain("hunter2");
        return yield* box.open(sealed, { ...aad, rowId: "other" });
      }).pipe(Effect.provide(SecretBox.insecureTest)),
    );
    expect(failureTag(exit)).toBe("OpenFailed");
  });
});

describe("KeyRing", () => {
  const build = (rootSecret: string, generations?: Parameters<typeof KeyRing.layer>[0]["generations"]) =>
    Effect.runPromiseExit(
      Effect.gen(function* () {
        return yield* KeyRing;
      }).pipe(
        Effect.provide(
          KeyRing.layer({ rootSecret: Redacted.make(rootSecret), ...(generations === undefined ? {} : { generations }) }),
        ),
      ),
    );

  it("refuses to boot with a weak, short or placeholder root secret (SEC-016)", async () => {
    expect(failureTag(await build("short"))).toBe("WeakRootSecret");
    expect(failureTag(await build("a".repeat(64)))).toBe("WeakRootSecret"); // no variety
    expect(failureTag(await build("fallback-auth-secret-fallback-auth-secret"))).toBe("WeakRootSecret");
    expect(failureTag(await build("dev-fallback-key-0123456789abcdefghijklmn"))).toBe("WeakRootSecret");
  });

  it("accepts a long random secret, including base64 (no hex assumption)", async () => {
    const exit = await build("kJ8vQ2mP9xLr4TnB7yHs5WcZ1dGfA3eU6iO0pNqMvXbY=");
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("rejects inconsistent generations", async () => {
    expect(failureTag(await build("kJ8vQ2mP9xLr4TnB7yHs5WcZ1dGfA3eU6iO0pNqMvXbY=", { column: { current: 3, accepted: [1, 2] } }))).toBe(
      "KeyRingConfigInvalid",
    );
    expect(failureTag(await build("kJ8vQ2mP9xLr4TnB7yHs5WcZ1dGfA3eU6iO0pNqMvXbY=", { column: { current: 0, accepted: [0] } }))).toBe(
      "KeyRingConfigInvalid",
    );
  });

  it("derives different keys per root secret (a different root cannot open the data)", async () => {
    const sealed = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* SecretBox).seal(secret, aad);
      }).pipe(Effect.provide(boxLayer())),
    );
    const otherRing = SecretBox.layer.pipe(
      Layer.provide(KeyRing.layer({ rootSecret: Redacted.make("another-totally-different-root-0123456789zz") })),
    );
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        return yield* (yield* SecretBox).open(sealed, aad);
      }).pipe(Effect.provide(otherRing)),
    );
    expect(failureTag(exit)).toBe("OpenFailed");
  });
});
