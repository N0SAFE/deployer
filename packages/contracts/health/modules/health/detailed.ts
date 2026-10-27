import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

// Define the input for the detailed endpoint
export const healthDetailedInput = z.object({});

/**
 * Supervisor health snapshot aggregated from the SupervisorOrchestratorService
 * (BaseSupervisorService subclasses auto-register there).
 */
export const supervisorHealthSchema = z.object({
  supervisorId: z.string(),
  description: z.string(),
  healthy: z.boolean(),
  // `pending` = deferred: a precondition does not exist yet (e.g. a swarm-only
  // service before setup created the cluster). Distinct from `degraded`.
  state: z.enum(["idle", "converging", "converged", "degraded", "pending"]),
  detail: z.string().nullable(),
  checkedAt: z.string(),
});

/**
 * One indicator's verdict.
 *
 * Shaped to be rendered directly: a UI shows `name`, a coloured dot from
 * `status`, and `latencyMs`; an operator reads `message` when it is down. The
 * free-form `detail` carries whatever THAT check learned (a server version, a
 * migration count, a memory ratio) without this schema having to know each
 * check's fields — which is what would otherwise make adding an indicator a
 * breaking contract change.
 */
export const healthIndicatorSchema = z.object({
  name: z.string(),
  status: z.enum(["up", "down"]),
  latencyMs: z.coerce.number(),
  /** Present when the check failed — the actionable reason. */
  message: z.string().optional(),
  reason: z.string().optional(),
  /** Check-specific facts (version, counts, ratios). Free-form by design. */
  detail: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The detailed health report.
 *
 * ── WHY `info` / `error` / `details` ARE LOOSE RECORDS ──────────────────────
 * They are TERMINUS' OWN payload shape (`HealthCheckResult`), passed through
 * unchanged so a Terminus client — or the Terminus UI — can consume this
 * response without a translation layer. Typing them strictly here would force
 * every indicator's detail into this schema, which is exactly the coupling that
 * makes a health contract brittle. The strict, renderable shape is `indicators`.
 */
export const healthDetailedOutput = z.object({
  status: z.string(),
  timestamp: z.date(),
  service: z.string(),
  /** Process uptime, in seconds. */
  uptime: z.coerce.number(),
  /** Terminus' `info`: indicators that are up, with their detail. */
  info: z.record(z.string(), z.unknown()),
  /** Terminus' `error`: indicators that are down, with the reason. */
  error: z.record(z.string(), z.unknown()),
  /** Terminus' `details`: every indicator, in both states. */
  details: z.record(z.string(), z.unknown()),
  /** The flattened, renderable list — in declaration order. */
  indicators: z.array(healthIndicatorSchema),
  supervisors: z.array(supervisorHealthSchema),
});

const healthDetailedOps = standard.zod(healthDetailedOutput, "healthDetailed");

// Define the contract
export const healthDetailedContract = healthDetailedOps
  .list()
  .path("/detailed")
  .input(healthDetailedInput)
  .output(healthDetailedOutput)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
