import { symlinkSync, existsSync } from "node:fs";

import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { FileSystem } from "./file-system";

const scenarios: readonly (readonly [string, () => Layer.Layer<FileSystem>])[] = [
  ["live (node:fs)", () => FileSystem.layer],
  ["test (in-memory)", () => FileSystem.test().layer],
];

describe.each(scenarios)("FileSystem %s", (name, makeLayer) => {
  const run = <A, E>(program: (fs: FileSystem["Service"], dir: string) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const dir = yield* fs.makeTempDirectory("fs-spec-");
          return yield* program(fs, dir);
        }),
      ).pipe(Effect.provide(makeLayer())),
    );

  it("writes create-only and refuses to overwrite", async () => {
    const result = await run((fs, dir) =>
      Effect.gen(function* () {
        yield* fs.writeFileExclusive(`${dir}/a.txt`, new TextEncoder().encode("one"));
        const again = yield* Effect.flip(fs.writeFileExclusive(`${dir}/a.txt`, new TextEncoder().encode("two")));
        const content = new TextDecoder().decode(yield* fs.readFile(`${dir}/a.txt`));
        return { again: again.kind, content };
      }),
    );
    expect(result).toEqual({ again: "AlreadyExists", content: "one" });
  });

  it("reports NotFound and kindOf undefined for a missing path", async () => {
    const result = await run((fs, dir) =>
      Effect.gen(function* () {
        const missing = yield* Effect.flip(fs.readFile(`${dir}/missing`));
        return { kind: missing.kind, kindOf: yield* fs.kindOf(`${dir}/missing`) };
      }),
    );
    expect(result).toEqual({ kind: "NotFound", kindOf: undefined });
  });

  it("creates nested directories and lists them", async () => {
    const names = await run((fs, dir) =>
      Effect.gen(function* () {
        yield* fs.mkdirp(`${dir}/x/y/z`);
        yield* fs.writeFileExclusive(`${dir}/x/f`, new Uint8Array([1, 2, 3]), { mode: 0o755 });
        expect(yield* fs.kindOf(`${dir}/x/y/z`)).toBe("directory");
        expect(yield* fs.size(`${dir}/x/f`)).toBe(3);
        return yield* fs.readdir(`${dir}/x`);
      }),
    );
    expect([...names]).toEqual(["f", "y"]);
  });

  it("enforces maxBytes on read", async () => {
    const kind = await run((fs, dir) =>
      Effect.gen(function* () {
        yield* fs.writeFileExclusive(`${dir}/big`, new Uint8Array(100));
        return (yield* Effect.flip(fs.readFile(`${dir}/big`, { maxBytes: 10 }))).kind;
      }),
    );
    expect(kind).toBe("TooLarge");
  });

  it("removes the temp directory when the scope closes", async () => {
    let captured = "";
    await run((_fs, dir) =>
      Effect.sync(() => {
        captured = dir;
      }),
    );
    expect(captured).not.toBe("");
    // Only the live layer touches the disk; the in-memory tree is dropped with its layer.
    if (name.startsWith("live")) expect(existsSync(captured)).toBe(false);
  });
});

describe("FileSystem live specifics", () => {
  it("does not follow symlinks in kindOf and refuses to write through a planted link", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const dir = yield* fs.makeTempDirectory("fs-link-");
          yield* fs.mkdirp(`${dir}/real`);
          symlinkSync(`${dir}/real`, `${dir}/link`);
          symlinkSync(`${dir}/real/target.txt`, `${dir}/planted`);
          const kind = yield* fs.kindOf(`${dir}/link`);
          // O_EXCL (wx) fails on an existing symlink even when its target does not exist.
          const write = yield* Effect.flip(fs.writeFileExclusive(`${dir}/planted`, new Uint8Array([1])));
          return { kind, write: write.kind, escaped: existsSync(`${dir}/real/target.txt`) };
        }),
      ).pipe(Effect.provide(FileSystem.layer)),
    );
    expect(result).toEqual({ kind: "symlink", write: "AlreadyExists", escaped: false });
  });
});
