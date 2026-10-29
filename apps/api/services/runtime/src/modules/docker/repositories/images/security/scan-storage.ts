/**
 * How a scan is stored: the hash that de-duplicates history rows, the persisted row read back as a scan, and
 * the detection of a database that has not run the scan-table migration yet. Pure, so it is tested without a database.
 */
import { createHash } from "node:crypto";
import type {
  DockerImageInspectDetail,
  DockerImageLayerEfficiency,
  DockerImageScannerResult,
} from "@deployer/contracts-entities";
import type { RawImageSecurityScan } from "./docker-image-scanner.types";

export interface PersistedScanRow {
  vulnerabilities: unknown;
  scanSummary: Record<string, unknown>;
  lastUpdated: Date;
}

export function computeScanHash(
  imageIdentifierNormalized: string,
  imageGeneration: number,
  scan: RawImageSecurityScan,
): string {
  return createHash("sha1")
    .update(
      `${imageIdentifierNormalized}:${String(imageGeneration)}:${JSON.stringify(scan.scanSummary)}:${JSON.stringify(scan.vulnerabilities)}`,
    )
    .digest("hex");
}

export function toPersistedScan(row: PersistedScanRow): {
  vulnerabilities: DockerImageInspectDetail["vulnerabilities"];
  scanSummary: RawImageSecurityScan["scanSummary"];
} {
  const vulnerabilities = row.vulnerabilities as DockerImageInspectDetail["vulnerabilities"];
  const rawSummary = row.scanSummary;

  return {
    vulnerabilities,
    scanSummary: {
      scannedAt: row.lastUpdated.toISOString(),
      totalFindings:
        typeof rawSummary.totalFindings === "number" ? rawSummary.totalFindings : vulnerabilities.length,
      scanners: Array.isArray(rawSummary.scanners) ? (rawSummary.scanners as DockerImageScannerResult[]) : [],
      layerEfficiency:
        (rawSummary.layerEfficiency as DockerImageLayerEfficiency | null | undefined) ?? null,
    },
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isMissingScanTableError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const code = typeof current === "object" && "code" in current && typeof (current as { code?: unknown }).code === "string"
      ? (current as { code: string }).code
      : null;
    if (code === "42P01") {
      return true;
    }

    const message = formatError(current).toLowerCase();
    if (
      message.includes('relation "docker_image_security_scans" does not exist')
      || (message.includes("docker_image_security_scans") && message.includes("does not exist"))
      || (message.includes("docker_image_security_scans") && message.includes("42p01"))
    ) {
      return true;
    }

    if (typeof current === "object") {
      const candidate = current as { cause?: unknown; originalError?: unknown; error?: unknown };
      for (const next of [candidate.cause, candidate.originalError, candidate.error]) {
        if (next !== undefined) {
          queue.push(next);
        }
      }
    }
  }

  return false;
}
