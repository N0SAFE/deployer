/**
 * ProvisioningPolicy — single derived decision object for HOW a node comes up.
 *
 * Replaces the scattered process.env.SETUP_AUTO / MANAGED_GLOBAL_DB_* /
 * ENABLE_DEV_BOOTSTRAP / ENABLE_SEEDING reads that previously made "how does
 * boot behave" the product of branch ORDER rather than one visible decision.
 *
 * The policy is a PURE function of the environment: two boots with the same
 * env produce the same policy. It is consumed by:
 *   - SetupDevService   (Phase 0: persist provided DB as a setup candidate)
 *   - OrchestratorService (boot decision log + admin bootstrap gate)
 *
 * NOTE on mode semantics (see docs/setup-lifecycle-complete.md §4):
 *   compose_managed — a Postgres is PROVIDED (MANAGED_GLOBAL_DB_*). That is
 *                     NOT a completed setup — schema + admin still missing.
 *   explicit_url    — SETUP_AUTO=true + an explicit URL. Same as above.
 *   managed         — SETUP_AUTO=true with NO URL: the wizard auto-provisions
 *                     a Docker Postgres container (dev) / supervisor (prod).
 *   manual          — no auto path: the human-driven wizard owns everything.
 */

import type { ManagedGlobalDbEnv } from "@repo/env";
import { resolveManagedGlobalDbUrl } from "@repo/env";

export type ProvisioningMode =
  | "compose_managed"
  | "explicit_url"
  | "managed"
  | "manual";

export type AdminBootstrapDecision = "always" | "when_empty" | "never";

/** Raw environment inputs the policy is derived from. */
export interface ProvisioningEnv {
  /** NODE_ENV — controls whether Phase-0 (dev-only) logic applies. */
  nodeEnv?: string;
  /** SETUP_AUTO (raw string or parsed boolean). */
  setupAuto?: string | boolean;
  /** SETUP_AUTO_DATABASE_URL ?? SETUP_DATABASE_URL — already trimmed. */
  explicitDatabaseUrl?: string;
  /** ADMIN_BOOTSTRAP (auto | true | false). */
  adminBootstrap?: string;
  /** ENABLE_DEV_BOOTSTRAP — deprecated alias, honoured in dev when ADMIN_BOOTSTRAP is unset. */
  enableDevBootstrap?: string | boolean;
  /** ENABLE_SEEDING — deprecated alias, honoured in prod when ADMIN_BOOTSTRAP is unset. */
  enableSeeding?: string | boolean;
  /** Parsed MANAGED_GLOBAL_DB_* config (managed.enabled + connection parts). */
  managed?: ManagedGlobalDbEnv;
}

export interface ProvisioningPolicy {
  mode: ProvisioningMode;
  /** Where the candidate database URL comes from (null when the wizard provisions). */
  dbSource: "compose" | "env_url" | "docker_container" | "supervisor" | null;
  /**
   * A database URL PROVIDED to this node before setup ran (compose-managed or
   * explicit env URL). When present, LocalInitializationService uses it as its
   * default database instead of provisioning a second container.
   */
  providedUrl: string | null;
  /** True when a human (or the auto-wizard) must run setup before the app is usable. */
  expectsWizard: boolean;
  /** Effective admin-bootstrap policy — see resolveAdminBootstrapDecision. */
  admin: AdminBootstrapDecision;
  /** Human-readable why for `admin` (alias honoured, mode default, …). */
  adminReason: string;
  /**
   * Phase-0 probe failure policy: when true an unreachable provided DB fails
   * boot hard (no silent candidate persist). True for compose/explicit modes
   * when SETUP_AUTO is on — a provided-but-dead DB must never degrade into a
   * half-configured node with a manual wizard hanging forever.
   */
  fatalIfUnreachable: boolean;
  isProd: boolean;
}

function asBool(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

function resolveMode(env: ProvisioningEnv): ProvisioningMode {
  const setupAuto = asBool(env.setupAuto) === true;
  const managedEnabled = env.managed?.enabled === true;

  if (managedEnabled) return "compose_managed";
  if (setupAuto && (env.explicitDatabaseUrl ?? "").length > 0) return "explicit_url";
  if (setupAuto) return "managed";
  return "manual";
}

function resolveProvidedUrl(env: ProvisioningEnv, mode: ProvisioningMode): string | null {
  if (mode === "compose_managed" && env.managed) {
    return resolveManagedGlobalDbUrl(env.managed);
  }
  if (mode === "explicit_url") return env.explicitDatabaseUrl ?? null;
  return null;
}

/**
 * Resolve the effective admin-bootstrap decision.
 *
 * Precedence:
 *   1. ADMIN_BOOTSTRAP=true|false (new canonical switch) — always wins.
 *   2. Deprecated aliases (honoured only when ADMIN_BOOTSTRAP is unset):
 *        dev  → ENABLE_DEV_BOOTSTRAP (false ⇒ never; true ⇒ always)
 *        prod → ENABLE_SEEDING      (true ⇒ always; else never — legacy default)
 *   3. Mode-based default:
 *        compose_managed / explicit_url → always (no wizard guarantees the admin)
 *        managed / manual               → when_empty (wizard seeds empty DBs)
 */
export function resolveAdminBootstrapDecision(
  env: ProvisioningEnv,
  mode?: ProvisioningMode,
): { decision: AdminBootstrapDecision; reason: string; aliasUsed?: "ENABLE_DEV_BOOTSTRAP" | "ENABLE_SEEDING" } {
  const resolvedMode = mode ?? resolveMode(env);
  const isProd = env.nodeEnv === "production";

  // 1. Explicit canonical switch.
  const adminBootstrap = env.adminBootstrap?.trim().toLowerCase();
  if (adminBootstrap === "true") {
    return { decision: "always", reason: "ADMIN_BOOTSTRAP=true (explicit)" };
  }
  if (adminBootstrap === "false") {
    return { decision: "never", reason: "ADMIN_BOOTSTRAP=false (explicit)" };
  }
  if (adminBootstrap && adminBootstrap !== "auto") {
    return { decision: "never", reason: `ADMIN_BOOTSTRAP="${adminBootstrap}" is invalid — treated as never` };
  }

  // 2. Deprecated aliases.
  if (!isProd) {
    const devBootstrap = asBool(env.enableDevBootstrap);
    if (devBootstrap === false) {
      return { decision: "never", reason: "ENABLE_DEV_BOOTSTRAP=false (deprecated alias)", aliasUsed: "ENABLE_DEV_BOOTSTRAP" };
    }
    if (devBootstrap === true) {
      return { decision: "always", reason: "ENABLE_DEV_BOOTSTRAP=true (deprecated alias)", aliasUsed: "ENABLE_DEV_BOOTSTRAP" };
    }
  } else {
    const seeding = asBool(env.enableSeeding);
    if (seeding === true) {
      return { decision: "always", reason: "ENABLE_SEEDING=true (deprecated alias)", aliasUsed: "ENABLE_SEEDING" };
    }
    if (seeding === false) {
      return { decision: "never", reason: "ENABLE_SEEDING=false (deprecated alias)", aliasUsed: "ENABLE_SEEDING" };
    }
  }

  // 3. Mode-based defaults.
  switch (resolvedMode) {
    case "compose_managed":
    case "explicit_url":
      return { decision: "always", reason: `mode=${resolvedMode} — admin ensured on every boot (no wizard fallback)` };
    case "managed":
    case "manual":
    default:
      return { decision: "when_empty", reason: `mode=${resolvedMode} — admin seeded by the wizard on an empty DB` };
  }
}

/**
 * Build the single provisioning policy for a boot.
 * Pure — no env access inside; the caller feeds in the raw values.
 */
export function resolveProvisioningPolicy(env: ProvisioningEnv): ProvisioningPolicy {
  const mode = resolveMode(env);
  const providedUrl = resolveProvidedUrl(env, mode);
  const setupAuto = asBool(env.setupAuto) === true;
  const { decision, reason } = resolveAdminBootstrapDecision(env, mode);

  // A provided DB is only fatal when SETUP_AUTO is on: with SETUP_AUTO off the
  // manual wizard stays alive so the operator can fix the DB and retry.
  const fatalIfUnreachable = setupAuto && (mode === "compose_managed" || mode === "explicit_url");

  return {
    mode,
    dbSource:
      mode === "compose_managed"
        ? "compose"
        : mode === "explicit_url"
          ? "env_url"
          : mode === "managed"
            ? env.nodeEnv === "production"
              ? "supervisor"
              : "docker_container"
            : null,
    providedUrl,
    expectsWizard:
      mode === "manual" ||
      mode === "managed" ||
      providedUrl !== null, // a candidate URL still requires setup to run
    admin: decision,
    adminReason: reason,
    fatalIfUnreachable,
    isProd: env.nodeEnv === "production",
  };
}

/** One-line human-readable summary — logged once at boot. */
export function describePolicy(policy: ProvisioningPolicy): string {
  return (
    `mode=${policy.mode} dbSource=${String(policy.dbSource)} ` +
    `providedUrl=${policy.providedUrl ? "yes" : "no"} expectsWizard=${String(policy.expectsWizard)} ` +
    `admin=${policy.admin} fatalIfUnreachable=${String(policy.fatalIfUnreachable)}`
  );
}

/** Convenience: build policy straight from process.env + a parsed managed-DB env. */
export function provisioningPolicyFromProcessEnv(
  managed?: ManagedGlobalDbEnv,
): ProvisioningPolicy {
  return resolveProvisioningPolicy({
    nodeEnv: process.env.NODE_ENV,
    setupAuto: process.env.SETUP_AUTO,
    explicitDatabaseUrl: (
      process.env.SETUP_AUTO_DATABASE_URL ??
      process.env.SETUP_DATABASE_URL ??
      ""
    ).trim(),
    adminBootstrap: process.env.ADMIN_BOOTSTRAP,
    enableDevBootstrap: process.env.ENABLE_DEV_BOOTSTRAP,
    enableSeeding: process.env.ENABLE_SEEDING,
    managed,
  });
}
