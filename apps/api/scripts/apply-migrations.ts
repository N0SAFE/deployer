/**
 * Apply pending global (Postgres) drizzle migrations directly, bypassing the
 * NestJS CLI bootstrap (which fails to resolve DI in the container).
 *
 * Usage (inside api container):
 *   bun --bun scripts/apply-migrations.ts
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { fileURLToPath } from "url";

const dbUrl = process.env.DATABASE_URL
    ?? "postgresql://deployer:deployer@172.18.0.1:32769/deployer";

const pool = new Pool({ connectionString: dbUrl });
const db = drizzle(pool);

const migrationsFolder = fileURLToPath(
    new URL("../src/config/drizzle/global/migrations", import.meta.url),
);

console.log(`Applying migrations from ${migrationsFolder}`);
await migrate(db, { migrationsFolder });
console.log("✅ Migrations applied successfully");

await pool.end();
