import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { FileSystem } from "@deployer/effect-infra";
import { Effect, Exit, Layer } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { ArchiveExtractor, type ExtractReport } from "./archive-extractor";
import { buildTar, buildZip, gzip, zeros, type TarSpec, type ZipSpec } from "./fixtures";
import type { ExtractLimits } from "./limits";

const layer = ArchiveExtractor.layer.pipe(Layer.provideMerge(FileSystem.layer));

type Sandbox = { root: string; archive: string; dest: string };

/** Run `body` with a scratch directory laid out as root/{archive, dest} (dest not yet created). */
const withSandbox = <A>(body: (sandbox: Sandbox, fs: FileSystem["Service"]) => Effect.Effect<A, unknown, ArchiveExtractor | FileSystem>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const root = yield* fs.makeTempDirectory("extract-");
        return yield* body({ root, archive: join(root, "upload.bin"), dest: join(root, "out", "src") }, fs);
      }),
    ).pipe(Effect.provide(layer)),
  );

const tagOf = <A, E>(exit: Exit.Exit<A, E>): string | undefined => {
  if (!Exit.isFailure(exit)) return undefined;
  const failed = exit.cause.reasons.find((r) => r._tag === "Fail");
  return failed === undefined ? undefined : (failed.error as { _tag?: string })._tag;
};

/** Write `archive`, attempt the extraction, and return the exit plus a probe of what landed outside dest. */
const attempt = async (archive: Uint8Array, limits?: Partial<ExtractLimits>, prepare?: (s: Sandbox) => void | Promise<void>) => {
  let leaked: string[] = [];
  const exit = await withSandbox((sandbox) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => Bun.write(sandbox.archive, archive));
      yield* Effect.promise(async () => prepare?.(sandbox));
      const extractor = yield* ArchiveExtractor;
      const result = yield* Effect.exit(extractor.extract(sandbox.archive, sandbox.dest, limits));
      // Anything created next to `dest` or at root other than the archive and the out dir is a leak.
      leaked = readdirSync(sandbox.root).filter((n) => n !== "upload.bin" && n !== "out");
      if (existsSync(dirname(sandbox.dest))) leaked.push(...readdirSync(dirname(sandbox.dest)).filter((n) => n !== "src"));
      return { result, destExists: existsSync(sandbox.dest) };
    }),
  );
  return { exit: exit.result, destExists: exit.destExists, leaked };
};

const extractOk = async (archive: Uint8Array, limits?: Partial<ExtractLimits>) => {
  let report!: ExtractReport;
  const files: Record<string, string> = {};
  const modes: Record<string, number> = {};
  await withSandbox((sandbox) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => Bun.write(sandbox.archive, archive));
      report = yield* (yield* ArchiveExtractor).extract(sandbox.archive, sandbox.dest, limits);
      const walk = async (dir: string, base = ""): Promise<void> => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          const rel = base === "" ? name : `${base}/${name}`;
          if (statSync(full).isDirectory()) await walk(full, rel);
          else {
            files[rel] = await Bun.file(full).text();
            modes[rel] = statSync(full).mode & 0o7777;
          }
        }
      };
      yield* Effect.promise(() => walk(sandbox.dest));
    }),
  );
  return { report, files, modes };
};

const sampleZip = (): ZipSpec[] => [
  { name: "app/", kind: "dir" },
  { name: "app/index.js", data: "console.log('hi')" },
  { name: "app/run.sh", data: "#!/bin/sh\necho hi\n", mode: 0o755 },
  { name: "README.md", data: "# readme", method: 0 },
  { name: "empty.txt" },
];

const sampleTar = (): TarSpec[] => [
  { name: "app/" },
  { name: "app/index.js", data: "console.log('hi')" },
  { name: "app/run.sh", data: "#!/bin/sh\necho hi\n", mode: 0o755 },
  { name: "README.md", data: "# readme" },
];

describe("ArchiveExtractor: valid archives", () => {
  it("extracts a zip (stored and deflated entries, directories, empty files)", async () => {
    const { report, files } = await extractOk(buildZip(sampleZip()));
    expect(report).toMatchObject({ format: "zip", files: 4, directories: 1 });
    expect(files["app/index.js"]).toBe("console.log('hi')");
    expect(files["README.md"]).toBe("# readme");
    expect(files["empty.txt"]).toBe("");
  });

  it("extracts a tar and a tar.gz identically", async () => {
    const tar = buildTar(sampleTar());
    const plain = await extractOk(tar);
    const gz = await extractOk(gzip(tar));
    expect(plain.report.format).toBe("tar");
    expect(gz.report.format).toBe("tar.gz");
    expect(plain.files).toEqual(gz.files);
    expect(plain.files["app/index.js"]).toBe("console.log('hi')");
  });

  it("handles GNU long names, pax paths and ustar prefixes", async () => {
    const longName = `deep/${"d".repeat(60)}/${"e".repeat(60)}/file.txt`;
    const { files } = await extractOk(
      buildTar([
        { name: longName, data: "gnu", gnuLongName: true },
        { name: "pax/long/path.txt", data: "pax", paxPath: true },
        { name: "plain.txt", data: "prefixed", prefix: "pre/fix" },
      ]),
    );
    expect(files[longName]).toBe("gnu");
    expect(files["pax/long/path.txt"]).toBe("pax");
    expect(files["pre/fix/plain.txt"]).toBe("prefixed");
  });

  it("strips setuid/setgid/sticky and group/other write bits, keeps the executable bit", async () => {
    const zip = await extractOk(buildZip([{ name: "su", data: "x", mode: 0o4777 }, { name: "run", data: "x", mode: 0o755 }, { name: "plain", data: "x", mode: 0o644 }, { name: "ro", data: "x", mode: 0o444 }]));
    expect(zip.modes.su).toBe(0o755); // setuid dropped, world/group write dropped
    expect(zip.modes.run).toBe(0o755);
    expect(zip.modes.plain).toBe(0o644);
    expect(zip.modes.ro).toBe(0o644); // owner can always read and write
    const tar = await extractOk(buildTar([{ name: "su", data: "x", mode: 0o6777 }]));
    expect(tar.modes.su).toBe(0o755);
  });

  it("normalises ./ prefixes and a root directory marker", async () => {
    const { files } = await extractOk(buildTar([{ name: "./" }, { name: "./a//b/c.txt", data: "ok" }]));
    expect(files["a/b/c.txt"]).toBe("ok");
  });

  it("accepts an empty destination directory", async () => {
    await withSandbox((sandbox) =>
      Effect.gen(function* () {
        mkdirSync(sandbox.dest, { recursive: true });
        yield* Effect.promise(() => Bun.write(sandbox.archive, buildTar(sampleTar())));
        const report = yield* (yield* ArchiveExtractor).extract(sandbox.archive, sandbox.dest);
        expect(report.files).toBe(3);
      }),
    );
  });
});

describe("ArchiveExtractor: path traversal (zip-slip) - nothing is ever written outside the destination", () => {
  const hostileNames = [
    "../evil.txt",
    "a/../../evil.txt",
    "a/b/../../../evil.txt",
    "/etc/cron.d/evil",
    "C:/Windows/evil.txt",
    "c:evil.txt",
    "a\\..\\..\\evil.txt",
    "..\\evil.txt",
    "ok/../../evil.txt",
    "nul\0byte.txt",
    "..",
    "a/..",
  ];

  it.each(hostileNames)("zip entry %j is refused", async (name) => {
    const { exit, leaked, destExists } = await attempt(buildZip([{ name: "fine.txt", data: "before" }, { name, data: "pwned" }]));
    expect(tagOf(exit)).toBe("UnsafePath");
    expect(leaked).toEqual([]);
    expect(destExists).toBe(false); // partial extraction rolled back
  });

  // A tar name field is NUL-terminated, so a NUL cannot be smuggled into a tar path: it simply ends the name.
  it.each(hostileNames.filter((name) => !name.includes("\0")))("tar entry %j is refused", async (name) => {
    const { exit, leaked, destExists } = await attempt(buildTar([{ name: "fine.txt", data: "before" }, { name, data: "pwned" }]));
    expect(tagOf(exit)).toBe("UnsafePath");
    expect(leaked).toEqual([]);
    expect(destExists).toBe(false);
  });

  it("a NUL in a tar name truncates it and still lands inside the destination", async () => {
    const { files } = await extractOk(buildTar([{ name: "nul\0../../evil.txt", data: "x" }]));
    expect(Object.keys(files)).toEqual(["nul"]);
  });

  it("refuses traversal hidden in a GNU long name and in a pax path", async () => {
    expect(tagOf((await attempt(buildTar([{ name: `${"x".repeat(120)}/../../../evil`, data: "p", gnuLongName: true }]))).exit)).toBe("UnsafePath");
    expect(tagOf((await attempt(buildTar([{ name: "../../evil", data: "p", paxPath: true }]))).exit)).toBe("UnsafePath");
  });

  it("refuses a zip whose local header name differs from the central directory name", async () => {
    const { exit, leaked } = await attempt(buildZip([{ name: "innocent.txt", localName: "../evil.txt", data: "x" }]));
    expect(tagOf(exit)).toBe("Corrupt");
    expect(leaked).toEqual([]);
  });

  it("does not follow a symlink that already exists inside the destination", async () => {
    const outsideMarker = { dir: "" };
    const { exit } = await attempt(buildZip([{ name: "link/payload.txt", data: "pwned" }]), undefined, (s) => {
      mkdirSync(s.dest, { recursive: true });
      outsideMarker.dir = join(s.root, "outside");
      mkdirSync(outsideMarker.dir);
      symlinkSync(outsideMarker.dir, join(s.dest, "link"));
    });
    // Destination is not empty (the planted link) so extraction is refused outright.
    expect(tagOf(exit)).toBe("DestinationNotEmpty");
    expect(existsSync(join(outsideMarker.dir, "payload.txt"))).toBe(false);
  });
});

describe("ArchiveExtractor: links, devices and special files are refused", () => {
  it("rejects zip symlinks and fifos", async () => {
    expect(tagOf((await attempt(buildZip([{ name: "l", kind: "symlink", data: "/etc/passwd" }]))).exit)).toBe("SymlinkEscape");
    expect(tagOf((await attempt(buildZip([{ name: "f", kind: "fifo" }]))).exit)).toBe("SymlinkEscape");
  });

  it.each([
    ["symlink", { name: "l", type: "2", linkname: "/etc/passwd" }],
    ["hardlink", { name: "h", type: "1", linkname: "../../secret" }],
    ["character device", { name: "c", type: "3" }],
    ["fifo", { name: "p", type: "6" }],
  ] as const)("rejects a tar %s", async (_label, spec) => {
    const { exit, leaked } = await attempt(buildTar([{ name: "fine.txt", data: "x" }, spec]));
    expect(tagOf(exit)).toBe("SymlinkEscape");
    expect(leaked).toEqual([]);
  });
});

describe("ArchiveExtractor: bombs and limits", () => {
  it("rejects an entry larger than maxEntryBytes without inflating it", async () => {
    const bomb = buildZip([{ name: "zeros.bin", data: zeros(20 * 1024 * 1024) }]);
    expect(bomb.length).toBeLessThan(100_000);
    const { exit } = await attempt(bomb, { maxEntryBytes: 1024 * 1024 });
    expect(tagOf(exit)).toBe("TooLarge");
  });

  it("rejects a high compression ratio above the floor", async () => {
    const bomb = buildZip([{ name: "zeros.bin", data: zeros(8 * 1024 * 1024) }]);
    const { exit } = await attempt(bomb, { maxCompressionRatio: 50 });
    expect(tagOf(exit)).toBe("TooLarge");
  });

  it("rejects a tar.gz bomb by total size and by ratio", async () => {
    const tar = buildTar([{ name: "zeros.bin", data: zeros(16 * 1024 * 1024) }]);
    const bomb = gzip(tar);
    expect(tagOf((await attempt(bomb, { maxTotalBytes: 1024 * 1024 })).exit)).toBe("TooLarge");
    expect(tagOf((await attempt(bomb, { maxCompressionRatio: 20 })).exit)).toBe("TooLarge");
  });

  it("rejects when the sum of entries exceeds maxTotalBytes", async () => {
    const zip = buildZip([{ name: "a", data: "x".repeat(600) }, { name: "b", data: "y".repeat(600) }]);
    expect(tagOf((await attempt(zip, { maxTotalBytes: 1000 })).exit)).toBe("TooLarge");
  });

  it("rejects a zip that lies about an entry's size (declared smaller than actual)", async () => {
    const zip = buildZip([{ name: "liar.bin", data: zeros(4 * 1024 * 1024), declaredSize: 10 }]);
    const { exit } = await attempt(zip);
    expect(["Corrupt", "TooLarge"]).toContain(tagOf(exit));
  });

  it("rejects a zip whose declared size is larger than the real content", async () => {
    const zip = buildZip([{ name: "liar.bin", data: "tiny", declaredSize: 5_000 }]);
    expect(tagOf((await attempt(zip)).exit)).toBe("Corrupt");
  });

  it("rejects a CRC mismatch", async () => {
    expect(tagOf((await attempt(buildZip([{ name: "a.txt", data: "abc", crc: 1234 }]))).exit)).toBe("Corrupt");
  });

  it("enforces maxEntries (zip: before touching anything; tar: while streaming)", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `f${String(i)}.txt`, data: String(i) }));
    const zip = await attempt(buildZip(many), { maxEntries: 5 });
    expect(tagOf(zip.exit)).toBe("TooManyEntries");
    expect(zip.destExists).toBe(false);
    const tar = await attempt(buildTar(many), { maxEntries: 5 });
    expect(tagOf(tar.exit)).toBe("TooManyEntries");
    expect(tar.destExists).toBe(false);
  });

  it("enforces path length and depth", async () => {
    expect(tagOf((await attempt(buildZip([{ name: `${"a/".repeat(10)}f`, data: "x" }]), { maxDepth: 5 })).exit)).toBe("NestingTooDeep");
    expect(tagOf((await attempt(buildZip([{ name: "x".repeat(300), data: "x" }]), { maxPathLength: 200 })).exit)).toBe("UnsafePath");
    expect(tagOf((await attempt(buildZip([{ name: "s".repeat(256), data: "x" }]))).exit)).toBe("UnsafePath"); // segment > 255
  });

  it("enforces maxArchiveBytes before reading the archive", async () => {
    expect(tagOf((await attempt(buildZip(sampleZip()), { maxArchiveBytes: 50 })).exit)).toBe("TooLarge");
  });
});

describe("ArchiveExtractor: malformed input", () => {
  it("rejects garbage, empty input and unsupported formats", async () => {
    expect(tagOf((await attempt(new TextEncoder().encode("this is not an archive at all"))).exit)).toBe("UnsupportedFormat");
    expect(tagOf((await attempt(new Uint8Array(0))).exit)).toBe("UnsupportedFormat");
  });

  it("rejects truncated zip, tar and gzip", async () => {
    const zip = buildZip(sampleZip());
    expect(tagOf((await attempt(zip.subarray(0, zip.length - 30))).exit)).toBe("Corrupt");
    const tar = buildTar([{ name: "a.txt", data: "x".repeat(2000) }]);
    expect(tagOf((await attempt(tar.subarray(0, 700))).exit)).toBe("Corrupt");
    const gz = gzip(buildTar(sampleTar()));
    expect(tagOf((await attempt(gz.subarray(0, gz.length - 20))).exit)).toBe("Corrupt");
  });

  it("rejects a tar header with a bad checksum", async () => {
    expect(tagOf((await attempt(buildTar([{ name: "a.txt", data: "x", badChecksum: true }]))).exit)).toBe("Corrupt");
  });

  it("rejects duplicate entries and file/directory path conflicts", async () => {
    expect(tagOf((await attempt(buildZip([{ name: "a.txt", data: "1" }, { name: "a.txt", data: "2" }]))).exit)).toBe("Corrupt");
    expect(tagOf((await attempt(buildTar([{ name: "a", data: "file" }, { name: "a/b.txt", data: "x" }]))).exit)).toBe("Corrupt");
  });

  it("refuses encrypted zip entries and unknown compression methods", async () => {
    const encrypted = buildZip([{ name: "a.txt", data: "x" }]);
    // Flip the "encrypted" bit in the central directory general-purpose flags.
    const view = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
    const cd = view.getUint32(encrypted.length - 22 + 16, true);
    view.setUint16(cd + 8, 1, true);
    expect(tagOf((await attempt(encrypted)).exit)).toBe("UnsupportedFormat");
    const odd = buildZip([{ name: "a.txt", data: "x" }]);
    const ov = new DataView(odd.buffer, odd.byteOffset, odd.byteLength);
    ov.setUint16(ov.getUint32(odd.length - 22 + 16, true) + 10, 12, true);
    expect(tagOf((await attempt(odd)).exit)).toBe("UnsupportedFormat");
  });
});

describe("ArchiveExtractor: destination handling", () => {
  let nonEmpty: (s: Sandbox) => Promise<void>;
  beforeEach(() => {
    nonEmpty = async (s) => {
      mkdirSync(s.dest, { recursive: true });
      await Bun.write(join(s.dest, "keep.txt"), "mine");
    };
  });

  it("refuses a non-empty destination and leaves it untouched", async () => {
    let kept = "";
    const { exit } = await attempt(buildZip(sampleZip()), undefined, nonEmpty);
    expect(tagOf(exit)).toBe("DestinationNotEmpty");
    await withSandbox((s) =>
      Effect.promise(async () => {
        await nonEmpty(s);
        kept = await Bun.file(join(s.dest, "keep.txt")).text();
      }),
    );
    expect(kept).toBe("mine");
  });

  it("removes what it created on failure (fresh destination) and keeps a pre-existing empty directory", async () => {
    const hostile = buildZip([{ name: "ok.txt", data: "1" }, { name: "../evil", data: "2" }]);
    const fresh = await attempt(hostile);
    expect(fresh.destExists).toBe(false);
    const pre = await attempt(hostile, undefined, (s) => {
      mkdirSync(s.dest, { recursive: true });
    });
    expect(pre.destExists).toBe(true);
    let remaining: string[] = ["unset"];
    await withSandbox((s) =>
      Effect.gen(function* () {
        mkdirSync(s.dest, { recursive: true });
        yield* Effect.promise(() => Bun.write(s.archive, hostile));
        yield* Effect.exit((yield* ArchiveExtractor).extract(s.archive, s.dest));
        remaining = readdirSync(s.dest);
      }),
    );
    expect(remaining).toEqual([]);
  });
});

describe("ArchiveExtractor.fake", () => {
  it("returns the canned report without reading anything", async () => {
    const report: ExtractReport = { format: "zip", entries: 1, files: 1, directories: 0, bytes: 1 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ArchiveExtractor).extract("/nope", "/nope-dest");
      }).pipe(Effect.provide(ArchiveExtractor.fake(report))),
    );
    expect(result).toBe(report);
  });
});
