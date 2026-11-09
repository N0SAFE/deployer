import { pgSchema, varchar } from 'drizzle-orm/pg-core'

/**
 * The PostgreSQL system catalogs this platform READS, described as Drizzle tables.
 *
 * WHY THEY ARE TABLES AND NOT RAW SQL
 * `select().from().where()` gives bound parameters and column types; a hand-written string gives
 * neither, so a schema name interpolated into it is one escaping mistake away from reading the
 * wrong catalog. Declaring the catalog read-only view costs one object and removes the string.
 *
 * WHY THIS FILE IS NOT IN `global/index.ts`
 * That barrel is `drizzle.config.ts`'s schema source, so anything it exports is diffed against the
 * database and EMITTED AS A MIGRATION. `information_schema` belongs to PostgreSQL: a migration that
 * tried to create it would fail (or, worse, succeed on a fresh cluster and then disagree with every
 * server in the world). Import it through its own subpath —
 * `@deployer/nest-schema/global/catalog` — precisely so the generator never sees it.
 */
const informationSchema = pgSchema('information_schema')

/**
 * One row per table or view the server knows about, restricted by `table_schema` / `table_type`.
 * Only the columns this platform filters or projects on are declared; the view has more.
 *
 * WHY NOTHING IS `.notNull()`
 * These are VIEWS over `pg_catalog`, and it shows: verified against PostgreSQL 16, every column of
 * `information_schema.tables` reports `is_nullable = YES`. A row surfaces only for an object the
 * current role may see, and the standard leaves enforcement to the server, so the type must admit
 * null rather than assert otherwise. Filtering with `where(...)` narrows what a caller gets, but it
 * does not let this schema claim a guarantee PostgreSQL never made.
 */
export const catalogTables = informationSchema.table('tables', {
    tableCatalog: varchar('table_catalog'),
    tableSchema: varchar('table_schema'),
    tableName: varchar('table_name'),
    tableType: varchar('table_type'),
})
