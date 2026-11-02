import { and, desc, eq, inArray } from "drizzle-orm";
import { Context, Effect } from "effect";

import type { DbError } from "@deployer/effect-infra";
import {
  dockerImageSecurityScanHistory,
  dockerImageSecurityScans,
} from "@deployer/nest-schema/global/runtime/docker-security-scan";

import { RuntimeDatabasePort, RuntimeDb } from "../../../../../core/database/runtime-db";

import { tolerateMissingScanTable } from "./tolerate-missing-scan-table";

import type { RawImageSecurityScan } from "./docker-image-scanner.types";
import type { PersistedScanRow } from "./scan-storage";

type DbRequirements = RuntimeDb | RuntimeDatabasePort;

export type SaveScanInput = {
  readonly imageId: string;
  readonly imageIdentifierNormalized: string;
  readonly imageGeneration: number;
  readonly scanHash: string;
  readonly scan: RawImageSecurityScan;
};

export type DockerImageScansStoreShape = {
  /** The newest stored scan for any of these identifiers (highest generation, then latest update), or null. */
  readonly findLatest: (identifiers: readonly string[]) => Effect.Effect<PersistedScanRow | null, DbError, DbRequirements>;
  /** When this generation was last scanned, or null when it never was. */
  readonly lastUpdated: (identifier: string, generation: number) => Effect.Effect<Date | null, DbError, DbRequirements>;
  /** Keep the scan in the history (once per content hash) and as the generation's current scan. */
  readonly save: (input: SaveScanInput) => Effect.Effect<void, DbError, DbRequirements>;
};

/** Stored image security scans; a constant that reads the database from the Effect context when it runs. */
export class DockerImageScansStore extends Context.Service<DockerImageScansStore, DockerImageScansStoreShape>()(
  "runtime/DockerImageScansStore",
) {
  static readonly live = class DockerImageScansStoreImpl implements DockerImageScansStoreShape {
    findLatest = (identifiers) =>
      identifiers.length === 0
        ? Effect.succeed(null)
        : Effect.flatMap(RuntimeDb, (database) =>
            database.use(async (db) => {
              const rows = await db
                .select({
                  vulnerabilities: dockerImageSecurityScans.vulnerabilities,
                  scanSummary: dockerImageSecurityScans.scanSummary,
                  lastUpdated: dockerImageSecurityScans.lastUpdated,
                })
                .from(dockerImageSecurityScans)
                .where(inArray(dockerImageSecurityScans.imageIdentifierNormalized, [...identifiers]))
                .orderBy(desc(dockerImageSecurityScans.imageGeneration), desc(dockerImageSecurityScans.lastUpdated))
                .limit(1);
              return rows[0] ?? null;
            }),
          ).pipe(tolerateMissingScanTable(null))

    lastUpdated = (identifier, generation) =>
      Effect.flatMap(RuntimeDb, (database) =>
        database.use(async (db) => {
          const rows = await db
            .select({ lastUpdated: dockerImageSecurityScans.lastUpdated })
            .from(dockerImageSecurityScans)
            .where(
              and(
                eq(dockerImageSecurityScans.imageIdentifierNormalized, identifier),
                eq(dockerImageSecurityScans.imageGeneration, generation),
              ),
            )
            .limit(1);
          return rows[0]?.lastUpdated ?? null;
        }),
      ).pipe(tolerateMissingScanTable(null))

    save = (input) =>
      Effect.flatMap(RuntimeDb, (database) =>
        database.use(async (db) => {
          const now = new Date();
          const { scan } = input;

          await db
            .insert(dockerImageSecurityScanHistory)
            .values({
              imageId: input.imageId,
              imageIdentifierNormalized: input.imageIdentifierNormalized,
              imageGeneration: input.imageGeneration,
              scanHash: input.scanHash,
              vulnerabilities: scan.vulnerabilities,
              scanSummary: scan.scanSummary,
              scanStatus: "completed",
              createdAt: now,
            })
            .onConflictDoNothing({ target: [dockerImageSecurityScanHistory.scanHash] });

          await db
            .insert(dockerImageSecurityScans)
            .values({
              imageId: input.imageId,
              imageIdentifierNormalized: input.imageIdentifierNormalized,
              imageGeneration: input.imageGeneration,
              vulnerabilities: scan.vulnerabilities,
              scanSummary: scan.scanSummary,
              scanStatus: "completed",
              lastUpdated: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [dockerImageSecurityScans.imageIdentifierNormalized, dockerImageSecurityScans.imageGeneration],
              set: {
                imageId: input.imageId,
                imageGeneration: input.imageGeneration,
                vulnerabilities: scan.vulnerabilities,
                scanSummary: scan.scanSummary,
                scanStatus: "completed",
                lastUpdated: now,
                updatedAt: now,
              },
            });
        }),
      ).pipe(tolerateMissingScanTable(undefined))
  };
}
