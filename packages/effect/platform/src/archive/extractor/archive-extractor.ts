import { FileSystem, type FsError } from "@deployer/effect-infra";
import { Context, Effect, Exit, Layer } from "effect";

import {
  Corrupt,
  DestinationNotEmpty,
  SymlinkEscape,
  TooLarge,
  TooManyEntries,
  type ArchiveError,
  UnsafePath,
} from "../errors";
import { DEFAULT_EXTRACT_LIMITS, RATIO_FLOOR_BYTES, type ExtractLimits } from "../limits";
import { entrySegments, joinUnder } from "../paths/safe-path";
import { detect, entriesOf, type ArchiveFormat } from "../readers/entries";

export type ExtractReport = {
  readonly format: ArchiveFormat;
  readonly entries: number;
  readonly files: number;
  readonly directories: number;
  /** Total uncompressed bytes written. */
  readonly bytes: number;
};

export type ArchiveExtractorShape = {
  /**
   * Extract `src` into `dest`. `dest` must not exist or must be an empty directory.
   * On ANY failure everything this call created is removed again.
   */
  readonly extract: (
    src: string,
    dest: string,
    limits?: Partial<ExtractLimits>,
  ) => Effect.Effect<ExtractReport, ArchiveError | FsError>;
};

const insideRealRoot = (real: string, realRoot: string): boolean =>
  real === realRoot || real.startsWith(realRoot.endsWith("/") ? realRoot : `${realRoot}/`);

/**
 * Safe archive extraction for untrusted uploads: pure TypeScript readers (no
 * `unzip`/`tar` binary, so nothing to inject into), containment on the resolved
 * path, every link/device/fifo refused, setuid/setgid/sticky and group/other write
 * bits stripped, files created create-only, and hard limits on entries, sizes,
 * ratio, path length and depth. Replaces `execSync("unzip ...")` and the unchecked
 * `path.join(extractPath, header.name)` of `git.service.ts` (SEC-014, DEPLOY-031).
 *
 * Known limits: the archive is read into memory (bounded by `maxArchiveBytes`);
 * streaming extraction is a follow-up. Zip names are decoded as UTF-8.
 */
export class ArchiveExtractor extends Context.Service<ArchiveExtractor, ArchiveExtractorShape>()(
  "platform/ArchiveExtractor",
) {
  static readonly layer: Layer.Layer<ArchiveExtractor, never, FileSystem> = Layer.effect(
    ArchiveExtractor,
    Effect.gen(function* () {
      const fs = yield* FileSystem;

      const extract: ArchiveExtractorShape["extract"] = (src, dest, partial) => {
        const limits: ExtractLimits = { ...DEFAULT_EXTRACT_LIMITS, ...partial };

        const prepareDestination = Effect.gen(function* () {
          const kind = yield* fs.kindOf(dest);
          if (kind === undefined) {
            yield* fs.mkdirp(dest);
            return { createdDest: true };
          }
          if (kind !== "directory") return yield* new DestinationNotEmpty({ dest });
          if ((yield* fs.readdir(dest)).length > 0) return yield* new DestinationNotEmpty({ dest });
          return { createdDest: false };
        });

        const cleanup = (createdDest: boolean) =>
          (createdDest
            ? fs.remove(dest, { recursive: true })
            : fs.readdir(dest).pipe(
                Effect.flatMap((names) => Effect.forEach(names, (name) => fs.remove(`${dest}/${name}`, { recursive: true }))),
              )
          ).pipe(Effect.ignore);

        return Effect.gen(function* () {
          const bytes = yield* fs
            .readFile(src, { maxBytes: limits.maxArchiveBytes })
            .pipe(
              Effect.mapError((error) =>
                error.kind === "TooLarge" ? new TooLarge({ what: "archive", limit: limits.maxArchiveBytes }) : error,
              ),
            );
          const format = yield* detect(bytes);
          const { createdDest } = yield* prepareDestination;

          const run = Effect.gen(function* () {
            const realDest = yield* fs.realpath(dest);
            const archiveEntries = yield* entriesOf(format, bytes, limits);
            let entries = 0;
            let files = 0;
            let directories = 0;
            let total = 0;

            for (const entry of archiveEntries) {
              entries++;
              if (entries > limits.maxEntries) return yield* new TooManyEntries({ limit: limits.maxEntries });
              if (entry.type !== "file" && entry.type !== "directory") {
                return yield* new SymlinkEscape({ entry: entry.path.slice(0, 200), kind: entry.type });
              }

              const segments = yield* entrySegments(entry.path, limits);
              if (segments.length === 0) {
                if (entry.type === "directory") continue; // "./" root marker
                return yield* new UnsafePath({ entry: entry.path.slice(0, 200), reason: "empty path" });
              }
              const full = yield* joinUnder(dest, segments, entry.path);

              if (entry.type === "directory") {
                yield* fs.mkdirp(full).pipe(Effect.mapError((e) => conflict(e)));
                directories++;
                continue;
              }

              if (entry.size > limits.maxEntryBytes) {
                return yield* new TooLarge({ what: "entry", limit: limits.maxEntryBytes, entry: entry.path.slice(0, 200) });
              }
              if (total + entry.size > limits.maxTotalBytes) {
                return yield* new TooLarge({ what: "total", limit: limits.maxTotalBytes });
              }
              if (
                entry.size > RATIO_FLOOR_BYTES &&
                entry.size / Math.max(1, entry.compressedSize) > limits.maxCompressionRatio
              ) {
                return yield* new TooLarge({ what: "ratio", limit: limits.maxCompressionRatio, entry: entry.path.slice(0, 200) });
              }

              const parent = full.slice(0, full.lastIndexOf("/"));
              yield* fs.mkdirp(parent).pipe(Effect.mapError((e) => conflict(e)));
              // Defence in depth: whatever the parent really is on disk must still be inside the destination.
              const realParent = yield* fs.realpath(parent);
              if (!insideRealRoot(realParent, realDest)) {
                return yield* new SymlinkEscape({ entry: entry.path.slice(0, 200), kind: "parent resolves outside destination" });
              }

              const content = yield* entry.read;
              // Strip setuid/setgid/sticky and group/other write; keep the owner able to read and write.
              const mode = (entry.mode & 0o755) | 0o600;
              yield* fs.writeFileExclusive(full, content, { mode }).pipe(
                Effect.mapError((e) => (e.kind === "AlreadyExists" ? new Corrupt({ reason: "duplicate entry" }) : e)),
              );
              files++;
              total += content.length;
            }

            return { format, entries, files, directories, bytes: total } satisfies ExtractReport;
          });

          // On failure, defect AND interruption, remove whatever this call created.
          return yield* run.pipe(
            Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : cleanup(createdDest))),
          );
        });
      };

      return ArchiveExtractor.of({ extract });
    }),
  );

  /** Test double returning a canned report (no archive is read). */
  static readonly fake = (report: ExtractReport): Layer.Layer<ArchiveExtractor> =>
    Layer.succeed(ArchiveExtractor, ArchiveExtractor.of({ extract: () => Effect.succeed(report) }));
}

/** A path that cannot be created because a file already occupies part of it is a malformed archive, not an I/O fault. */
const conflict = (error: FsError): FsError | Corrupt =>
  error.kind === "AlreadyExists" || error.kind === "NotDirectory"
    ? new Corrupt({ reason: "entry path conflicts with an earlier entry" })
    : error;
