/**
 * DefaultAdminBootstrap — ensure the platform's default admin exists.
 *
 * Mirror of `LocalInitializationService.seedInitialData` (setup-wizard path):
 * create the super-admin through the Better Auth service-side API — the
 * single source of truth for user/account creation and password hashing —
 * then promote to superAdmin + mark email verified.
 *
 * Difference vs. the wizard path: this is used by the orchestrator AFTER
 * global migrations, gated by the ProvisioningPolicy admin decision (see
 * OrchestratorService.bootstrapSeededAdmin and provisioning-policy.ts):
 *   - compose_managed / explicit_url → admin ensured on every boot
 *   - managed / manual               → admin seeded by the wizard on an empty DB
 *
 * NON-SILENT: the function NEVER swallows errors — every call returns a
 * discriminated outcome (created | existed | failed). Callers decide the
 * failure policy (the orchestrator fails the boot when an admin-required path
 * cannot create one).
 *
 * NO INVENTED CREDENTIALS, NO PROMOTION BY EMAIL: a missing email or password
 * used to fall back to `admin@admin.com` / `adminadmin`, and an existing user
 * whose email matched was silently raised to superAdmin. Both are gone: the
 * credentials must be configured, and an existing account keeps its role until
 * an admin grants it explicitly.
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { provisionUserAccount } from "@deployer/auth/server";
import * as globalSchema from "@deployer/nest-schema/global";
import { user } from "@deployer/nest-schema/global/identity/auth";

import { createBetterAuth } from "../../config/auth/auth";

export type EnsureDefaultAdminResult =
  | { outcome: "created"; userId: string }
  /**
   * No longer emitted: an existing user is never granted a role by matching an
   * email (see the body). Kept only because `BootstrapOrchestratorService`
   * still branches on it, and that file is outside this change — delete both
   * together.
   */
  | { outcome: "promoted"; userId: string }
  | { outcome: "existed"; userId: string }
  | { outcome: "failed"; error: string };

export type EnsureDefaultAdminOptions = {
  email?: string;
  password?: string;
  name?: string;
}

export async function ensureDefaultAdmin(
  databaseUrl: string,
  options?: EnsureDefaultAdminOptions,
): Promise<EnsureDefaultAdminResult> {
  const email = (options?.email ?? process.env.DEFAULT_ADMIN_EMAIL ?? "").trim();
  const password = options?.password ?? process.env.DEFAULT_ADMIN_PASSWORD ?? "";

  // No invented credentials. This used to fall back to `admin@admin.com` /
  // `adminadmin`, which meant every install that merely FORGOT to configure the
  // variables shipped with a known super-admin password. Both are now required;
  // the caller gets one actionable line and nothing is written.
  if (email.length === 0 || password.length === 0) {
    return {
      outcome: "failed",
      error:
        "DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD must both be set to create the default admin — " +
        "set them, or create the account through the setup wizard / `create-default-admin` CLI",
    };
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool, { schema: globalSchema });

    // Existing user → report it and stop. Never promote by email: a row whose
    // address happens to match a configured variable is not evidence that the
    // operator wants that account to become a super-admin. Elevation is an
    // explicit grant (admin plugin `setRole`), never a side effect of a boot.
    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (existing[0]) {
      return { outcome: "existed", userId: existing[0].id };
    }

    // Created through Better Auth's internal adapter (NOT `signUpEmail`: public
    // sign-up is disabled, and that endpoint is the public door). The adapter is
    // still the single source of truth for the credential account + password
    // hash, and the role is written at creation, so the account never exists in
    // an unprivileged state.
    const { auth } = createBetterAuth(db, {
      DEV_AUTH_KEY: process.env.DEV_AUTH_KEY,
      DEFAULT_ADMIN_EMAIL: email,
      NODE_ENV: process.env.NODE_ENV ?? "development",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET,
      BASE_URL: process.env.NEXT_PUBLIC_API_URL,
      APP_URL: process.env.APP_URL,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
      AUTH_BASE_DOMAIN: process.env.AUTH_BASE_DOMAIN,
    });

    const userId = await provisionUserAccount(auth, {
      email,
      name: options?.name ?? "Default Admin",
      password,
      role: "superAdmin",
    });

    return { outcome: "created", userId };
  } catch (error) {
    // Never silent — the outcome carries the error and the caller decides the
    // failure policy (boot fail vs. continue).
    return {
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}