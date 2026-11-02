import { Context, Layer } from "effect";

import { makeLiveFileSystem } from "./live";
import { makeMemoryFileSystem } from "./memory";

import type { FileSystemShape } from "./types";

/**
 * Filesystem port. `layer` is the real filesystem (see `live.ts`); `test` is a behaviour-faithful
 * in-memory tree (see `memory.ts`).
 */
export class FileSystem extends Context.Service<FileSystem, FileSystemShape>()("infra/FileSystem") {
  static readonly layer: Layer.Layer<FileSystem> = Layer.succeed(FileSystem, FileSystem.of(makeLiveFileSystem()));

  static readonly test = (): {
    readonly layer: Layer.Layer<FileSystem>;
    readonly files: Map<string, { bytes: Uint8Array; mode: number }>;
    readonly dirs: Set<string>;
  } => {
    const { shape, files, dirs } = makeMemoryFileSystem();
    return { layer: Layer.succeed(FileSystem, FileSystem.of(shape)), files, dirs };
  };
}
