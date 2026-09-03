/**
 * Debug: show what the drizzle migrator sees for the last applied migration.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL
    ?? "postgresql://deployer:deployer@172.18.0.1:32769/deployer";

const pool = new Pool({ connectionString: dbUrl });
const db = drizzle(pool);

const rows = await db.execute(sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 3`);
console.log("rows:", JSON.stringify(rows, null, 2));

await pool.end();
