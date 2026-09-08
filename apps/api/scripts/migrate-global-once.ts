// One-off: apply pending global Postgres migrations (non-interactive).
// Run inside the api-dev container: bun --bun scripts/migrate-global-once.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const url =
  process.env.SETUP_DATABASE_URL ??
  `postgres://${process.env.MANAGED_GLOBAL_DB_USER ?? 'deployer'}:${process.env.MANAGED_GLOBAL_DB_PASSWORD ?? 'deployer'}@${process.env.MANAGED_GLOBAL_DB_HOST ?? 'global-db'}:${process.env.MANAGED_GLOBAL_DB_PORT ?? '5432'}/${process.env.MANAGED_GLOBAL_DB_NAME ?? 'deployer'}`

const pool = new pg.Pool({ connectionString: url })
const db = drizzle(pool)
const migrationsFolder = new URL('../src/config/drizzle/global/migrations', import.meta.url).pathname

console.log('Migrating global DB at', url.replace(/:[^:@/]+@/, ':***@'))
await migrate(db, { migrationsFolder })
await pool.end()
console.log('Global migrations applied successfully')