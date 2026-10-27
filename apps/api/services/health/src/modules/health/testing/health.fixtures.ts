import type { HealthSnapshot } from "@deployer/shared/server";
import type { z } from "zod";

import type { healthCheckOutput, healthDetailedOutput } from "@deployer/health-contracts";

import type { HealthRegistryShape } from "../services/health.service";

export type HealthCheckPayload = z.infer<typeof healthCheckOutput>;
export type HealthDetailedPayload = z.infer<typeof healthDetailedOutput>;

/** One registry snapshot; tests override only the field under assertion. */
export function healthSnapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    status: "up",
    info: { database: { status: "up", latencyMs: 3, version: "PostgreSQL 16.4" } },
    error: {},
    details: { database: { status: "up", latencyMs: 3 } },
    indicators: [
      {
        name: "database",
        status: "up",
        latencyMs: 3,
        detail: { version: "PostgreSQL 16.4" },
      },
    ],
    checkedAt: "2026-10-09T00:00:00.000Z",
    durationMs: 4,
    ...overrides,
  };
}

/** Minimal registry double: the port only exposes `runOnce`. */
export function healthRegistryFake(
  runOnce: () => Promise<HealthSnapshot>,
): HealthRegistryShape {
  return { runOnce };
}

export function healthCheckPayload(overrides: Partial<HealthCheckPayload> = {}): HealthCheckPayload {
  return {
    status: "ok",
    timestamp: new Date("2026-10-09T00:00:00.000Z"),
    service: "svc-health",
    indicators: [
      { name: "database", status: "up", latencyMs: 3, detail: { version: "PostgreSQL 16.4" } },
    ],
    ...overrides,
  };
}

export function healthDetailedPayload(
  overrides: Partial<HealthDetailedPayload> = {},
): HealthDetailedPayload {
  return {
    status: "ok",
    timestamp: new Date("2026-10-09T00:00:00.000Z"),
    service: "svc-health",
    uptime: 12.5,
    info: { database: { status: "up", latencyMs: 3 } },
    error: {},
    details: { database: { status: "up", latencyMs: 3 } },
    indicators: [
      { name: "database", status: "up", latencyMs: 3, detail: { version: "PostgreSQL 16.4" } },
    ],
    supervisors: [],
    ...overrides,
  };
}
