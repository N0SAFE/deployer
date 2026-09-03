/**
 * Replicates SetupWizardService.triggerInitialize → LocalInitializationService
 * seedInitialData against the deployer Postgres, then marks node_config as
 * setup_done so the API boots fully configured. Run inside the API container.
 *
 * Usage:
 *   bun seed-admin.ts postgresql://deployer:deployer@172.18.0.1:32770/deployer
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import * as globalSchema from "@/config/drizzle/global/schema";
import { user, organization, member } from "@/config/drizzle/global/schema";

const databaseUrl = process.argv[2];
if (!databaseUrl) {
  console.error("Usage: bun seed-admin.ts <DATABASE_URL>");
  process.exit(1);
}

const email = process.env.DEFAULT_ADMIN_EMAIL ?? "admin@admin.com";
const password = process.env.DEFAULT_ADMIN_PASSWORD ?? "adminadmin";
const name = process.env.DEFAULT_ADMIN_NAME ?? "Admin";
const organizationName = process.env.DEFAULT_ADMIN_ORGANIZATION ?? "My Organization";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const db = drizzle(pool, { schema: globalSchema });

  const userId = randomUUID();
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const accountId = randomUUID();
  const now = new Date();
  const slug = slugify(organizationName);

  const passwordHash = await hashPassword(password);
  console.log("bcrypt hash computed");

  await db.insert(user).values({
    id: userId,
    name,
    email,
    emailVerified: true,
    role: "superAdmin",
    createdAt: now,
    updatedAt: now,
  });
  console.log("user row written:", email);

  await db.insert(globalSchema.account).values({
    id: accountId,
    accountId: email,
    providerId: "credential",
    userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  console.log("account row written");

  await db.insert(organization).values({
    id: organizationId,
    name: organizationName,
    slug,
    createdAt: now,
    metadata: null,
  });
  console.log("organization row written:", slug);

  await db.insert(member).values({
    id: memberId,
    organizationId,
    userId,
    role: "owner",
    createdAt: now,
  });
  console.log("member row written");

  await pool.end();

  // ── Mark node_config as setup_done so the API skips the wizard ──────────
  const sqlite = new Database("/app/data/local.db");
  const seededAt = new Date().toISOString();
  const row = sqlite
    .query("SELECT node_id, strategy, mesh_shared_secret FROM node_config WHERE id = 1")
    .get() as { node_id: string; strategy: string; mesh_shared_secret: string } | null;

  if (!row) {
    console.error("node_config row missing — cannot mark setup_done");
    process.exit(1);
  }

  sqlite
    .query(
      `UPDATE node_config SET
         setup_state = 'setup_done',
         database_url = ?,
         configured_at = ?,
         updated_at = ?
       WHERE id = 1`,
    )
    .run(databaseUrl, seededAt, seededAt);

  const check = sqlite
    .query("SELECT node_id, setup_state, database_url FROM node_config WHERE id = 1")
    .get();
  console.log("node_config updated:", JSON.stringify(check));
  sqlite.close();

  console.log("✅ Done — API will boot configured on next restart");
}

main().catch((err) => {
  console.error("❌ seed failed:", err);
  process.exit(1);
});
