import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm } from "node:fs/promises";

import { fromAbortable } from "@deployer/effect-core";
import { Context, Data, Effect, Layer, type Scope } from "effect";

export class FsError extends Data.TaggedError("FsError")<{
  readonly op: string;
  readonly path: string;
  /** `NotFound`, `AlreadyExists`, `NotEmpty`, `NotDirectory`, `TooLarge` (a `maxBytes` bound was hit) or `Other`. */
  readonly kind: "NotFound" | "AlreadyExists" | "NotEmpty" | "NotDirectory" | "TooLarge" | "Other";
  readonly message: string;
}> {}

export type FileKind = "file" | "directory" | "symlink" | "other";

export type FileSystemShape = {
  /** Reads at most `maxBytes` (default unlimited); a larger file fails with `kind: "TooLarge"`. */
  readonly readFile: (path: string, options?: { readonly maxBytes?: number }) => Effect.Effect<Uint8Array, FsError>;
  /** `lstat`: does not follow symlinks. `undefined` when the path does not exist. */
  readonly kindOf: (path: string) => Effect.Effect<FileKind | undefined, FsError>;
  readonly size: (path: string) => Effect.Effect<number, FsError>;
  readonly mkdirp: (path: string) => Effect.Effect<void, FsError>;
  /** Create-only (`O_EXCL`): fails `AlreadyExists` instead of overwriting or following a planted link. */
  readonly writeFileExclusive: (path: string, bytes: Uint8Array, options?: { readonly mode?: number }) => Effect.Effect<void, FsError>;
  readonly realpath: (path: string) => Effect.Effect<string, FsError>;
  readonly readdir: (path: string) => Effect.Effect<readonly string[], FsError>;
  readonly remove: (path: string, options?: { readonly recursive?: boolean }) => Effect.Effect<void, FsError>;
  /** A fresh directory that is removed (recursively) when the scope closes. */
  readonly makeTempDirectory: (prefix: string) => Effect.Effect<string, FsError, Scope.Scope>;
};

const kindOfError = (error: unknown): FsError["kind"] => {
  const code = (error as { code?: string } | undefined)?.code;
  switch (code) {
    case "ENOENT":
      return "NotFound";
    case "EEXIST":
      return "AlreadyExists";
    case "ENOTEMPTY":
      return "NotEmpty";
    case "ENOTDIR":
      return "NotDirectory";
    case "E2BIG":
      return "TooLarge";
    default:
      return "Other";
  }
};

const fsError = (op: string, path: string) => (cause: unknown) =>
  new FsError({ op, path, kind: kindOfError(cause), message: cause instanceof Error ? cause.message : String(cause) });

const coded = (message: string, code: string): Error => Object.assign(new Error(message), { code });

const kindFromStats = (stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileKind =>
  stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other";

const dirname = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
};

/** Collapse duplicate slashes and `.` segments, resolve `..`, drop a trailing slash. Absolute paths only. */
const normalize = (path: string): string => {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
};

/**
 * Filesystem port.
 *
 * Reads and writes use Bun builtins (`Bun.file(...).bytes()`, `Bun.write`). Bun has no
 * builtin for create-only (`O_EXCL`) opens, `lstat`, `mkdir -p`, `readdir`, `realpath`,
 * `rm -r`, `mkdtemp` or `chmod`, so exactly those go through `node:fs/promises`
 * (implemented natively by Bun). The `Test` layer is a behaviour-faithful in-memory tree.
 */
export class FileSystem extends Context.Service<FileSystem, FileSystemShape>()("infra/FileSystem") {
  static readonly layer: Layer.Layer<FileSystem> = Layer.succeed(
    FileSystem,
    FileSystem.of({
      readFile: (path, options) =>
        fromAbortable(async () => {
          const file = Bun.file(path);
          if (!(await file.exists())) throw coded(`ENOENT: no such file ${path}`, "ENOENT");
          if (options?.maxBytes !== undefined && file.size > options.maxBytes) {
            throw coded(`file exceeds ${String(options.maxBytes)} bytes`, "E2BIG");
          }
          return await file.bytes();
        }, fsError("readFile", path)),
      kindOf: (path) =>
        fromAbortable(async () => {
          try {
            return kindFromStats(await lstat(path));
          } catch (error) {
            if (kindOfError(error) === "NotFound") return undefined;
            throw error;
          }
        }, fsError("kindOf", path)),
      size: (path) => fromAbortable(async () => (await lstat(path)).size, fsError("size", path)),
      mkdirp: (path) =>
        fromAbortable(async () => {
          await mkdir(path, { recursive: true });
        }, fsError("mkdirp", path)),
      writeFileExclusive: (path, bytes, options) =>
        fromAbortable(async () => {
          // `wx` = O_CREAT|O_EXCL: fails on any existing entry, including a dangling symlink.
          const handle = await open(path, "wx", options?.mode ?? 0o644);
          try {
            await Bun.write(Bun.file(handle.fd), bytes);
            // `open` applies the umask; make the intended mode exact.
            if (options?.mode !== undefined) await handle.chmod(options.mode);
          } finally {
            await handle.close();
          }
        }, fsError("writeFileExclusive", path)),
      realpath: (path) => fromAbortable(() => realpath(path), fsError("realpath", path)),
      readdir: (path) => fromAbortable(() => readdir(path), fsError("readdir", path)),
      remove: (path, options) =>
        fromAbortable(() => rm(path, { recursive: options?.recursive === true, force: false }), fsError("remove", path)),
      makeTempDirectory: (prefix) =>
        Effect.acquireRelease(
          fromAbortable(() => mkdtemp(`${Bun.env.TMPDIR ?? "/tmp"}/${prefix}`), fsError("makeTempDirectory", prefix)),
          (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
        ),
    }),
  );

  /**
   * In-memory tree for specs: same errors and create-only semantics as the live layer,
   * no disk. `realpath` is the identity (this tree has no symlinks).
   */
  static readonly test = (): {
    readonly layer: Layer.Layer<FileSystem>;
    readonly files: Map<string, { bytes: Uint8Array; mode: number }>;
    readonly dirs: Set<string>;
  } => {
    const files = new Map<string, { bytes: Uint8Array; mode: number }>();
    const dirs = new Set<string>(["/"]);
    const err = (op: string, path: string, kind: FsError["kind"]) =>
      new FsError({ op, path, kind, message: `${op} ${path}: ${kind}` });
    const ensureParents = (path: string) => {
      let current = "";
      for (const part of dirname(path).split("/").filter(Boolean)) {
        current += `/${part}`;
        dirs.add(current);
      }
    };
    let counter = 0;
    const shape: FileSystemShape = {
      readFile: (path, options) => {
        const file = files.get(normalize(path));
        if (file === undefined) return Effect.fail(err("readFile", path, "NotFound"));
        if (options?.maxBytes !== undefined && file.bytes.length > options.maxBytes) {
          return Effect.fail(err("readFile", path, "TooLarge"));
        }
        return Effect.succeed(file.bytes);
      },
      kindOf: (path) => {
        const p = normalize(path);
        return Effect.succeed(files.has(p) ? "file" : dirs.has(p) ? "directory" : undefined);
      },
      size: (path) => {
        const file = files.get(normalize(path));
        return file === undefined ? Effect.fail(err("size", path, "NotFound")) : Effect.succeed(file.bytes.length);
      },
      mkdirp: (path) =>
        Effect.sync(() => {
          const p = normalize(path);
          ensureParents(`${p}/x`);
          dirs.add(p);
        }),
      writeFileExclusive: (path, bytes, options) =>
        Effect.suspend(() => {
          const p = normalize(path);
          if (files.has(p) || dirs.has(p)) return Effect.fail(err("writeFileExclusive", path, "AlreadyExists"));
          if (!dirs.has(dirname(p))) return Effect.fail(err("writeFileExclusive", path, "NotFound"));
          files.set(p, { bytes: new Uint8Array(bytes), mode: options?.mode ?? 0o644 });
          return Effect.void;
        }),
      realpath: (path) => {
        const p = normalize(path);
        return files.has(p) || dirs.has(p) ? Effect.succeed(p) : Effect.fail(err("realpath", path, "NotFound"));
      },
      readdir: (path) => {
        const p = normalize(path);
        if (!dirs.has(p)) return Effect.fail(err("readdir", path, "NotFound"));
        const prefix = p === "/" ? "/" : `${p}/`;
        const names = new Set<string>();
        for (const entry of [...files.keys(), ...dirs]) {
          if (entry === p || !entry.startsWith(prefix)) continue;
          const name = entry.slice(prefix.length).split("/")[0];
          if (name !== undefined) names.add(name);
        }
        return Effect.succeed([...names].sort());
      },
      remove: (path, options) =>
        Effect.suspend(() => {
          const p = normalize(path);
          const prefix = `${p}/`;
          const children = [...files.keys(), ...dirs].filter((e) => e.startsWith(prefix));
          if (children.length > 0 && options?.recursive !== true) return Effect.fail(err("remove", path, "NotEmpty"));
          for (const child of children) {
            files.delete(child);
            dirs.delete(child);
          }
          if (!files.delete(p) && !dirs.delete(p)) return Effect.fail(err("remove", path, "NotFound"));
          return Effect.void;
        }),
      makeTempDirectory: (prefix) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const dir = `/tmp/${prefix}${String(++counter)}`;
            ensureParents(`${dir}/x`);
            dirs.add(dir);
            return dir;
          }),
          (dir) =>
            Effect.sync(() => {
              for (const entry of [...files.keys(), ...dirs]) {
                if (entry === dir || entry.startsWith(`${dir}/`)) {
                  files.delete(entry);
                  dirs.delete(entry);
                }
              }
            }),
        ),
    };
    return { layer: Layer.succeed(FileSystem, FileSystem.of(shape)), files, dirs };
  };
}
