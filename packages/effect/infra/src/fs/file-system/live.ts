import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm } from "node:fs/promises";

import { fromAbortable } from "@deployer/effect-core";
import { Effect } from "effect";

import { FsError } from "./errors";
import { fsError, kindFromStats } from "./helpers";
import type { FileSystemShape } from "./types";

const failure = (op: string, path: string, kind: FsError["kind"], message: string) => new FsError({ op, path, kind, message });

/**
 * The real filesystem. Reads and writes use Bun builtins (`Bun.file(...).bytes()`, `Bun.write`). Bun
 * has no builtin for create-only (`O_EXCL`) opens, `lstat`, `mkdir -p`, `readdir`, `realpath`,
 * `rm -r`, `mkdtemp` or `chmod`, so exactly those go through `node:fs/promises` (implemented
 * natively by Bun). Every failure is a typed `FsError` whose `kind` is the errno, never a throw.
 */
export const makeLiveFileSystem = (): FileSystemShape => ({
  readFile: (path, options) =>
    Effect.gen(function* () {
      const file = Bun.file(path);
      if (!(yield* fromAbortable(() => file.exists(), fsError("readFile", path)))) {
        return yield* Effect.fail(failure("readFile", path, "NotFound", `ENOENT: no such file ${path}`));
      }
      if (options?.maxBytes !== undefined && file.size > options.maxBytes) {
        return yield* Effect.fail(failure("readFile", path, "TooLarge", `file exceeds ${String(options.maxBytes)} bytes`));
      }
      return yield* fromAbortable(() => file.bytes(), fsError("readFile", path));
    }),

  kindOf: (path) =>
    fromAbortable(() => lstat(path), fsError("kindOf", path)).pipe(
      Effect.map(kindFromStats),
      Effect.catch((error) => (error.kind === "NotFound" ? Effect.succeed(undefined) : Effect.fail(error))),
    ),

  size: (path) => fromAbortable(async () => (await lstat(path)).size, fsError("size", path)),

  mkdirp: (path) => fromAbortable(() => mkdir(path, { recursive: true }), fsError("mkdirp", path)).pipe(Effect.asVoid),

  // `wx` = O_CREAT|O_EXCL: fails on any existing entry, including a dangling symlink.
  writeFileExclusive: (path, bytes, options) =>
    Effect.acquireUseRelease(
      fromAbortable(() => open(path, "wx", options?.mode ?? 0o644), fsError("writeFileExclusive", path)),
      (handle) =>
        fromAbortable(async () => {
          await Bun.write(Bun.file(handle.fd), bytes);
          // `open` applies the umask; make the intended mode exact.
          if (options?.mode !== undefined) await handle.chmod(options.mode);
        }, fsError("writeFileExclusive", path)),
      (handle) => Effect.promise(() => handle.close()),
    ),

  realpath: (path) => fromAbortable(() => realpath(path), fsError("realpath", path)),

  readdir: (path) => fromAbortable(() => readdir(path), fsError("readdir", path)),

  remove: (path, options) =>
    fromAbortable(() => rm(path, { recursive: options?.recursive === true, force: false }), fsError("remove", path)),

  makeTempDirectory: (prefix) =>
    Effect.acquireRelease(
      fromAbortable(() => mkdtemp(`${Bun.env.TMPDIR ?? "/tmp"}/${prefix}`), fsError("makeTempDirectory", prefix)),
      (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
    ),
});
