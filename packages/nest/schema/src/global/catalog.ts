import {
    boolean,
    integer,
    pgSchema,
    real,
    smallint,
    text,
    varchar,
} from 'drizzle-orm/pg-core'

/**
 * The PostgreSQL system catalogs, described as Drizzle tables.
 *
 * WHY THIS IS A LIBRARY AND NOT A ONE-OFF
 * Every introspection this platform needs — "does this database already have tables", "which
 * columns does `node_config` have", "did the migration add the constraint" — would otherwise be a
 * hand-written string with a schema name interpolated into it. A string gives no bound parameters,
 * no column types, and no compiler check when a catalog column is renamed. Declaring the catalogs
 * once means a caller writes `select().from().where()` like any other table.
 *
 * WHY IT IS NOT IN `global/index.ts`
 * That barrel is `drizzle.config.ts`'s schema source, so anything it exports is diffed against the
 * database and EMITTED AS A MIGRATION. These catalogs belong to PostgreSQL: a migration that tried
 * to create them would fail, or worse, succeed on a fresh cluster and then disagree with every
 * server in the world. Import this through its own subpath —
 * `@deployer/nest-schema/global/catalog` — so the generator never sees it.
 *
 * HOW THE TYPES WERE CHOSEN
 * Derived from a live PostgreSQL 16, not from memory:
 *   - `information_schema` columns are ALL nullable (`is_nullable = YES`), because they are views
 *     over `pg_catalog` and the standard leaves enforcement to the server. None carries `.notNull()`;
 *     a caller filters, and that narrows what it reads without claiming a server guarantee.
 *   - `pg_catalog` columns are mostly `NOT NULL`, and those are marked as such.
 *   - Column types follow what the driver actually returns: `pg-types` registers `oid` (26) with
 *     `parseInteger`, so `oid` is `integer`; `"char"` and `name` arrive as strings, so they are
 *     `text`; `real` / `smallint` / `boolean` map directly. `regproc` is NOT parsed, so it is `text`.
 *
 * COLUMNS ARE DELIBERATELY INCOMPLETE
 * These declare the columns a query is likely to project or filter on, not all of them — only the
 * ACL and `pg_node_tree` columns are omitted. Add a column when a query needs it.
 */

const informationSchema = pgSchema('information_schema')
const pgCatalog = pgSchema('pg_catalog')

// ─── information_schema ─────────────────────────────────────────────────────

/** One row per table or view visible to the current role. */
export const catalogTables = informationSchema.table('tables', {
    tableCatalog: varchar('table_catalog'),
    tableSchema: varchar('table_schema'),
    tableName: varchar('table_name'),
    tableType: varchar('table_type'),
    selfReferencingColumnName: varchar('self_referencing_column_name'),
    referenceGeneration: varchar('reference_generation'),
    userDefinedTypeCatalog: varchar('user_defined_type_catalog'),
    userDefinedTypeSchema: varchar('user_defined_type_schema'),
    userDefinedTypeName: varchar('user_defined_type_name'),
    isInsertableInto: varchar('is_insertable_into'),
    isTyped: varchar('is_typed'),
    commitAction: varchar('commit_action'),
})

/** One row per column of every table or view visible to the current role. */
export const catalogColumns = informationSchema.table('columns', {
    tableCatalog: varchar('table_catalog'),
    tableSchema: varchar('table_schema'),
    tableName: varchar('table_name'),
    columnName: varchar('column_name'),
    ordinalPosition: integer('ordinal_position'),
    columnDefault: varchar('column_default'),
    isNullable: varchar('is_nullable'),
    dataType: varchar('data_type'),
    characterMaximumLength: integer('character_maximum_length'),
    characterOctetLength: integer('character_octet_length'),
    numericPrecision: integer('numeric_precision'),
    numericPrecisionRadix: integer('numeric_precision_radix'),
    numericScale: integer('numeric_scale'),
    datetimePrecision: integer('datetime_precision'),
    intervalType: varchar('interval_type'),
    intervalPrecision: integer('interval_precision'),
    characterSetCatalog: varchar('character_set_catalog'),
    characterSetSchema: varchar('character_set_schema'),
    characterSetName: varchar('character_set_name'),
    collationCatalog: varchar('collation_catalog'),
    collationSchema: varchar('collation_schema'),
    collationName: varchar('collation_name'),
    domainCatalog: varchar('domain_catalog'),
    domainSchema: varchar('domain_schema'),
    domainName: varchar('domain_name'),
    udtCatalog: varchar('udt_catalog'),
    udtSchema: varchar('udt_schema'),
    udtName: varchar('udt_name'),
    scopeCatalog: varchar('scope_catalog'),
    scopeSchema: varchar('scope_schema'),
    scopeName: varchar('scope_name'),
    maximumCardinality: integer('maximum_cardinality'),
    dtdIdentifier: varchar('dtd_identifier'),
    isSelfReferencing: varchar('is_self_referencing'),
    isIdentity: varchar('is_identity'),
    identityGeneration: varchar('identity_generation'),
    identityStart: varchar('identity_start'),
    identityIncrement: varchar('identity_increment'),
    identityMaximum: varchar('identity_maximum'),
    identityMinimum: varchar('identity_minimum'),
    identityCycle: varchar('identity_cycle'),
    isGenerated: varchar('is_generated'),
    generationExpression: varchar('generation_expression'),
    isUpdatable: varchar('is_updatable'),
})

/** One row per view visible to the current role, with the SQL that defines it. */
export const catalogViews = informationSchema.table('views', {
    tableCatalog: varchar('table_catalog'),
    tableSchema: varchar('table_schema'),
    tableName: varchar('table_name'),
    viewDefinition: varchar('view_definition'),
    checkOption: varchar('check_option'),
    isUpdatable: varchar('is_updatable'),
    isInsertableInto: varchar('is_insertable_into'),
    isTriggerUpdatable: varchar('is_trigger_updatable'),
    isTriggerDeletable: varchar('is_trigger_deletable'),
    isTriggerInsertableInto: varchar('is_trigger_insertable_into'),
})

/** One row per constraint on a table or domain visible to the current role. */
export const catalogTableConstraints = informationSchema.table(
    'table_constraints',
    {
        constraintCatalog: varchar('constraint_catalog'),
        constraintSchema: varchar('constraint_schema'),
        constraintName: varchar('constraint_name'),
        tableCatalog: varchar('table_catalog'),
        tableSchema: varchar('table_schema'),
        tableName: varchar('table_name'),
        constraintType: varchar('constraint_type'),
        isDeferrable: varchar('is_deferrable'),
        initiallyDeferred: varchar('initially_deferred'),
        enforced: varchar('enforced'),
        // PostgreSQL 15+. Absent on an older server, so a caller must not assume it is populated.
        nullsDistinct: varchar('nulls_distinct'),
    }
)

/** The columns that make up primary-key, unique and foreign-key constraints. */
export const catalogKeyColumnUsage = informationSchema.table(
    'key_column_usage',
    {
        constraintCatalog: varchar('constraint_catalog'),
        constraintSchema: varchar('constraint_schema'),
        constraintName: varchar('constraint_name'),
        tableCatalog: varchar('table_catalog'),
        tableSchema: varchar('table_schema'),
        tableName: varchar('table_name'),
        columnName: varchar('column_name'),
        ordinalPosition: integer('ordinal_position'),
        positionInUniqueConstraint: integer('position_in_unique_constraint'),
    }
)

/** The columns referenced by a constraint owned by the current role. */
export const catalogConstraintColumnUsage = informationSchema.table(
    'constraint_column_usage',
    {
        tableCatalog: varchar('table_catalog'),
        tableSchema: varchar('table_schema'),
        tableName: varchar('table_name'),
        columnName: varchar('column_name'),
        constraintCatalog: varchar('constraint_catalog'),
        constraintSchema: varchar('constraint_schema'),
        constraintName: varchar('constraint_name'),
    }
)

/** Referential actions and match rules for foreign keys. */
export const catalogReferentialConstraints = informationSchema.table(
    'referential_constraints',
    {
        constraintCatalog: varchar('constraint_catalog'),
        constraintSchema: varchar('constraint_schema'),
        constraintName: varchar('constraint_name'),
        uniqueConstraintCatalog: varchar('unique_constraint_catalog'),
        uniqueConstraintSchema: varchar('unique_constraint_schema'),
        uniqueConstraintName: varchar('unique_constraint_name'),
        matchOption: varchar('match_option'),
        updateRule: varchar('update_rule'),
        deleteRule: varchar('delete_rule'),
    }
)

/** The check-clause text of every check constraint visible to the current role. */
export const catalogCheckConstraints = informationSchema.table(
    'check_constraints',
    {
        constraintCatalog: varchar('constraint_catalog'),
        constraintSchema: varchar('constraint_schema'),
        constraintName: varchar('constraint_name'),
        checkClause: varchar('check_clause'),
    }
)

/** One row per sequence visible to the current role. */
export const catalogSequences = informationSchema.table('sequences', {
    sequenceCatalog: varchar('sequence_catalog'),
    sequenceSchema: varchar('sequence_schema'),
    sequenceName: varchar('sequence_name'),
    dataType: varchar('data_type'),
    numericPrecision: integer('numeric_precision'),
    numericPrecisionRadix: integer('numeric_precision_radix'),
    numericScale: integer('numeric_scale'),
    startValue: varchar('start_value'),
    minimumValue: varchar('minimum_value'),
    maximumValue: varchar('maximum_value'),
    increment: varchar('increment'),
    cycleOption: varchar('cycle_option'),
})

// ─── pg_catalog ─────────────────────────────────────────────────────────────

/** Schema (namespace) registry, including the system schemas. */
export const pgNamespace = pgCatalog.table('pg_namespace', {
    oid: integer('oid').notNull(),
    nspname: text('nspname').notNull(),
    nspowner: integer('nspowner').notNull(),
    nspacl: text('nspacl'),
})

/** Relation registry: tables, indexes, views, sequences, materialized views, … */
export const pgClass = pgCatalog.table('pg_class', {
    oid: integer('oid').notNull(),
    relname: text('relname').notNull(),
    relnamespace: integer('relnamespace').notNull(),
    reltype: integer('reltype').notNull(),
    reloftype: integer('reloftype').notNull(),
    relowner: integer('relowner').notNull(),
    relam: integer('relam').notNull(),
    relfilenode: integer('relfilenode').notNull(),
    reltablespace: integer('reltablespace').notNull(),
    relpages: integer('relpages').notNull(),
    reltuples: real('reltuples').notNull(),
    relallvisible: integer('relallvisible').notNull(),
    reltoastrelid: integer('reltoastrelid').notNull(),
    relhasindex: boolean('relhasindex').notNull(),
    relisshared: boolean('relisshared').notNull(),
    relpersistence: text('relpersistence').notNull(),
    relkind: text('relkind').notNull(),
    relnatts: smallint('relnatts').notNull(),
    relchecks: smallint('relchecks').notNull(),
    relhasrules: boolean('relhasrules').notNull(),
    relhastriggers: boolean('relhastriggers').notNull(),
    relhassubclass: boolean('relhassubclass').notNull(),
    relrowsecurity: boolean('relrowsecurity').notNull(),
    relforcerowsecurity: boolean('relforcerowsecurity').notNull(),
    relispopulated: boolean('relispopulated').notNull(),
    relreplident: text('relreplident').notNull(),
    relispartition: boolean('relispartition').notNull(),
    relacl: text('relacl'),
    reloptions: text('reloptions').array(),
})

/** Attribute (column) definitions, including the system columns. */
export const pgAttribute = pgCatalog.table('pg_attribute', {
    attrelid: integer('attrelid').notNull(),
    attname: text('attname').notNull(),
    atttypid: integer('atttypid').notNull(),
    attlen: smallint('attlen').notNull(),
    attnum: smallint('attnum').notNull(),
    attcacheoff: integer('attcacheoff').notNull(),
    atttypmod: integer('atttypmod').notNull(),
    attndims: smallint('attndims').notNull(),
    attbyval: boolean('attbyval').notNull(),
    attalign: text('attalign').notNull(),
    attstorage: text('attstorage').notNull(),
    attcompression: text('attcompression').notNull(),
    attnotnull: boolean('attnotnull').notNull(),
    atthasdef: boolean('atthasdef').notNull(),
    atthasmissing: boolean('atthasmissing').notNull(),
    attidentity: text('attidentity').notNull(),
    attgenerated: text('attgenerated').notNull(),
    attisdropped: boolean('attisdropped').notNull(),
    attislocal: boolean('attislocal').notNull(),
    attinhcount: smallint('attinhcount').notNull(),
    attstattarget: smallint('attstattarget').notNull(),
    attcollation: integer('attcollation').notNull(),
    attacl: text('attacl'),
    attoptions: text('attoptions').array(),
})

/** Type registry: every base, composite, domain, array and pseudo type. */
export const pgType = pgCatalog.table('pg_type', {
    oid: integer('oid').notNull(),
    typname: text('typname').notNull(),
    typnamespace: integer('typnamespace').notNull(),
    typowner: integer('typowner').notNull(),
    typlen: smallint('typlen').notNull(),
    typbyval: boolean('typbyval').notNull(),
    typtype: text('typtype').notNull(),
    typcategory: text('typcategory').notNull(),
    typispreferred: boolean('typispreferred').notNull(),
    typisdefined: boolean('typisdefined').notNull(),
    typdelim: text('typdelim').notNull(),
    typrelid: integer('typrelid').notNull(),
    // regproc: `pg-types` does not register it, so the driver hands back its text form.
    typsubscript: text('typsubscript').notNull(),
    typelem: integer('typelem').notNull(),
    typarray: integer('typarray').notNull(),
    typinput: text('typinput').notNull(),
    typoutput: text('typoutput').notNull(),
    typreceive: text('typreceive').notNull(),
    typsend: text('typsend').notNull(),
    typmodin: text('typmodin').notNull(),
    typmodout: text('typmodout').notNull(),
    typanalyze: text('typanalyze').notNull(),
    typalign: text('typalign').notNull(),
    typstorage: text('typstorage').notNull(),
    typnotnull: boolean('typnotnull').notNull(),
    typbasetype: integer('typbasetype').notNull(),
    typtypmod: integer('typtypmod').notNull(),
    typndims: integer('typndims').notNull(),
    typcollation: integer('typcollation').notNull(),
    typdefault: text('typdefault'),
    typacl: text('typacl'),
})
