/**
 * The default-admin bootstrap decision for a boot.
 *
 * ── WHAT THIS REPLACED, AND WHY IT IS SMALLER ───────────────────────────────
 * This file used to be `ProvisioningPolicy`: a four-mode object
 * (`compose_managed` / `explicit_url` / `managed` / `manual`) that answered "how
 * does this node come up?" — which database it uses, whether a wizard is
 * expected, whether an unreachable database should fail the boot.
 *
 * All of that was **pre-setup** logic: it existed because the API could be
 * launched before onboarding, so it had to work out where its database would
 * come from. The API no longer starts in that phase — `apps/setup` runs first and
 * persists the operator's choice to `node_config`, and the API reads it. The
 * modes therefore described states that can no longer occur, and the only
 * question left that the BOOT still has to answer is the admin one:
 *
 *   on a node that is already set up, is the default admin this process's job?
 *
 * ── WHO OWNS THE ADMIN ON A FRESH INSTALL ──────────────────────────────────
 * The WIZARD does, and it must: `LocalInitializationService.seedInitialData`
 * creates the super-admin from the credentials the OPERATOR typed. The boot
 * pipeline runs on the restart path only (it requires `setupState ===
 * "setup_done"`), because creating an admin from `DEFAULT_ADMIN_*` defaults on a
 * fresh install would produce an account nobody chose and, worse, would happen
 * alongside the wizard's own seeding.
 *
 * ── THE DECISION ───────────────────────────────────────────────────────────
 *   1. `ADMIN_BOOTSTRAP` (canonical). `auto` means "use the mode default".
 *   2. Deprecated aliases, honoured only when `ADMIN_BOOTSTRAP` is unset:
 *        dev  → `ENABLE_DEV_BOOTSTRAP`
 *        prod → `ENABLE_SEEDING`
 *   3. Default: `always`.
 *
 * The default is `always` because of WHERE this runs. Every call site is the
 * restart path of a node whose setup already completed, and an install that must
 * be usable but has no credentials is orphaned. "Would prefer an admin exists"
 * is the wrong question there — the right one is "is it missing?", which the
 * bootstrap answers idempotently.
 */

export type AdminBootstrapDecision = "always" | "when_empty" | "never";

function asBool(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

/**
 * Resolve whether this boot should ensure the default admin.
 *
 * Pure: every input arrives as an argument, so the decision can be asserted
 * without mutating `process.env` (and a spec cannot leak state between cases).
 */
export function resolveAdminBootstrapDecision(env: {
  adminBootstrap?: string;
  enableDevBootstrap?: string | boolean;
  enableSeeding?: string | boolean;
  nodeEnv?: string;
}): { decision: AdminBootstrapDecision; reason: string } {
  // 1. The canonical switch wins outright.
  const explicit = env.adminBootstrap?.trim().toLowerCase();
  if (explicit === "true") {
    return { decision: "always", reason: "ADMIN_BOOTSTRAP=true (explicit)" };
  }
  if (explicit === "false") {
    return { decision: "never", reason: "ADMIN_BOOTSTRAP=false (explicit)" };
  }
  if (explicit !== undefined && explicit !== "" && explicit !== "auto") {
    // An unrecognised value is treated as `never` rather than silently defaulting
    // to `always`: a typo in a security-adjacent switch must not create accounts.
    return {
      decision: "never",
      reason: `ADMIN_BOOTSTRAP="${explicit}" is invalid — treated as never`,
    };
  }

  // 2. Deprecated aliases, honoured only while the canonical switch is `auto`.
  if (env.nodeEnv === "production") {
    const seeding = asBool(env.enableSeeding);
    if (seeding === true) {
      return { decision: "always", reason: "ENABLE_SEEDING=true (deprecated alias)" };
    }
    if (seeding === false) {
      return { decision: "never", reason: "ENABLE_SEEDING=false (deprecated alias)" };
    }
  } else {
    const devBootstrap = asBool(env.enableDevBootstrap);
    if (devBootstrap === false) {
      return { decision: "never", reason: "ENABLE_DEV_BOOTSTRAP=false (deprecated alias)" };
    }
    if (devBootstrap === true) {
      return { decision: "always", reason: "ENABLE_DEV_BOOTSTRAP=true (deprecated alias)" };
    }
  }

  // 3. The default for a node that is already set up.
  return {
    decision: "always",
    reason: "default — this boot path only runs on an already-configured node",
  };
}

/** Convenience: resolve straight from `process.env`. */
export function adminBootstrapDecisionFromProcessEnv(): {
  decision: AdminBootstrapDecision;
  reason: string;
} {
  return resolveAdminBootstrapDecision({
    adminBootstrap: process.env.ADMIN_BOOTSTRAP,
    enableDevBootstrap: process.env.ENABLE_DEV_BOOTSTRAP,
    enableSeeding: process.env.ENABLE_SEEDING,
    nodeEnv: process.env.NODE_ENV,
  });
}
