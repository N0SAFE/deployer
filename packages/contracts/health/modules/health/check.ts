import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

// Define the input for the check endpoint
export const healthCheckInput = z.object({});

/**
 * One indicator's verdict, as reported by `check`.
 *
 * Deliberately the SAME shape as the detailed endpoint's indicator: a caller that
 * fetched either gets a renderable list, and the two cannot drift into "check
 * says up while detailed says the database is down".
 */
export const healthCheckIndicatorSchema = z.object({
  name: z.string(),
  status: z.enum(["up", "down"]),
  latencyMs: z.coerce.number(),
  message: z.string().optional(),
  reason: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The output for the check endpoint.
 *
 * ── WHY IT CARRIES INDICATORS AND NOT JUST `status` ─────────────────────────
 * A probe answering only `ok`/`degraded` says something is wrong but not WHAT, so
 * diagnosing it needs a second request or a log dive. The indicator list is the
 * difference between "something is off" and "the database is unreachable, the
 * schema is migrated, memory is fine".
 *
 * `indicators` is OPTIONAL so a lighter implementation — and the preflight-only
 * gate — can satisfy this contract without producing a full report.
 */
export const healthCheckOutput = z.object({
  status: z.string(),
  timestamp: z.date(),
  service: z.string().optional(),
  /** Per-indicator verdicts, in declaration order. */
  indicators: z.array(healthCheckIndicatorSchema).optional(),
});

const healthCheckOps = standard.zod(healthCheckOutput, "healthCheck");

// Define the contract
export const healthCheckContract = healthCheckOps
  .list()
  .path("/")
  .input(healthCheckInput)
  .output(healthCheckOutput)
  .errors((e) => [
    // 503 when a dependency is down.
    ...standardDomainErrorContracts(e),
  ])
  .build();
