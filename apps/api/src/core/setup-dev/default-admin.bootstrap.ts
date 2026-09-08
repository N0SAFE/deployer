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
 * Idempotent: existing user → ensures superAdmin role, else no-op.
 *
 * NON-SILENT: the function NEVER swallows errors — every call returns a
 * discriminated outcome (created | promoted | existed | failed). Callers
 * decide the failure policy (the orchestrator fails the boot when an
 * admin-required path cannot create one).
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Roles } from "@repo/auth/permissions";
import { user } from "@/config/drizzle/global/schema/auth";
import * as globalSchema from "@/config/drizzle/global/schema";
import { createBetterAuth } from "@/config/auth/auth";

export type EnsureDefaultAdminResult =
  | { outcome: "created"; userId: string }
  | { outcome: "promoted"; userId: string }
  | { outcome: "existed"; userId: string }
  | { outcome: "failed"; error: string };

export interface EnsureDefaultAdminOptions {
  email?: string;
  password?: string;
  name?: string;
}

export async function ensureDefaultAdmin(
  databaseUrl: string,
  options?: EnsureDefaultAdminOptions,
): Promise<EnsureDefaultAdminResult> {
  const emailRaw = (options?.email ?? process.env.DEFAULT_ADMIN_EMAIL ?? "").trim();
  const email = emailRaw.length > 0 ? emailRaw : "admin@admin.com";
  const passwordRaw = options?.password ?? process.env.DEFAULT_ADMIN_PASSWORD ?? "";
  const password = passwordRaw.length > 0 ? passwordRaw : "adminadmin";

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool, { schema: globalSchema });

    // Existing user → ensure superAdmin, never duplicate.
    const existing = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (existing[0]) {
      if (existing[0].role !== Roles.superAdmin) {
        await db
          .update(user)
          .set({ role: Roles.superAdmin, emailVerified: true })
          .where(eq(user.id, existing[0].id));
        return { outcome: "promoted", userId: existing[0].id };
      }
      return { outcome: "existed", userId: existing[0].id };
    }

    // Create through Better Auth so the credential account + password hash
    // match exactly what sign-in/email expects (issuer "local:credential",
    // configured hash algorithm — hardcoding would break INVALID_EMAIL_OR_PASSWORD).
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

    const signUpResult = await auth.api.signUpEmail({
      body: {
        name: options?.name ?? "Default Admin",
        email,
        password,
      },
    });
    const userId = signUpResult.user.id;

    await db
      .update(user)
      .set({ emailVerified: true, role: Roles.superAdmin })
      .where(eq(user.id, userId));

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