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
 */
export const catalogTables = informationSchema.table('tables', {
    tableCatalog: varchar('table_catalog').notNull(),
    tableSchema: varchar('table_schema').notNull(),
    tableName: varchar('table_name').notNull(),
    tableType: varchar('table_type').notNull(),
})
