/**
 * Deployer Version Utility
 *
 * Reads the app version from package.json at import time using
 * readFileSync (not require()) so it works with verbatimModuleSyntax
 * and ESM imports. Caches the result in a module-level constant.
 *
 * Usage:
 *   import { DEPLOYER_VERSION, semverCompare } from '@/core/utils/deployer-version'
 *
 *   if (semverCompare(DEPLOYER_VERSION, "2.0.0") < 0) {
 *     // DEPLOYER_VERSION < 2.0.0
 *   }
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AppError } from "@repo/errors";
// ─── Resolve path ──────────────────────────────────────────────────────────────
// This file lives at: apps/api/src/core/utils/deployer-version.ts
// Target:          apps/api/package.json

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_PATH = join(__dirname, "..", "..", "..", "..", "package.json");

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _cachedVersion: string | null = null;

function resolveVersion(): string {
  if (_cachedVersion) return _cachedVersion;

  try {
    const raw = readFileSync(PKG_PATH, "utf-8");
    _cachedVersion = JSON.parse(raw).version ?? "0.0.0";
  } catch {
    _cachedVersion = "0.0.0";
  }

  return _cachedVersion!;
}

/** The deployer's app version as resolved from package.json (e.g. "1.0.0"). */
export const DEPLOYER_VERSION: string = resolveVersion();

// ─── Semver utilities ──────────────────────────────────────────────────────────

/**
 * Simple semver comparison (MAJOR.MINOR.PATCH only, no pre-release).
 *
 * Returns:
 *   -1 if a < b
 *    0 if a == b
 *    1 if a > b
 *
 * Throws on malformed input (non-numeric segments).
 */
export function semverCompare(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = i < pa.length ? pa[i]! : 0;
    const nb = i < pb.length ? pb[i]! : 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Returns true when `version` satisfies the `required` semver range.
 *
 * Supports:
 *   - ">=X.Y.Z"
 *   - ">X.Y.Z"
 *   - "X.Y.Z" (exact match)
 *   - "X.Y.Z - A.B.C" (range, inclusive)
 *
 * Throws on unsupported range patterns.
 */
export function semverSatisfies(version: string, required: string): boolean {
  const trimmed = required.trim();

  // Exact match
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return semverCompare(version, trimmed) === 0;
  }

  // >=X.Y.Z
  if (trimmed.startsWith(">=")) {
    return semverCompare(version, trimmed.slice(2)) >= 0;
  }

  // >X.Y.Z
  if (trimmed.startsWith(">")) {
    return semverCompare(version, trimmed.slice(1)) > 0;
  }

  // <=X.Y.Z
  if (trimmed.startsWith("<=")) {
    return semverCompare(version, trimmed.slice(2)) <= 0;
  }

  // <X.Y.Z
  if (trimmed.startsWith("<")) {
    return semverCompare(version, trimmed.slice(1)) < 0;
  }

  // X.Y.Z - A.B.C (inclusive range)
  const rangeMatch = trimmed.match(/^(\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+)$/);
  if (rangeMatch) {
    return semverCompare(version, rangeMatch[1]!) >= 0 && semverCompare(version, rangeMatch[2]!) <= 0;
  }

  throw new AppError(`Unsupported semver range pattern: "${required}"`, "VERSION_PARSE_ERROR");
}
