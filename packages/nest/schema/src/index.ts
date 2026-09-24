/**
 * @repo/nest-schema — Drizzle table definitions for the local (SQLite) and
 * global (Postgres) databases.
 *
 * WHAT THIS PACKAGE IS: table shapes, relations, enums and the two custom
 * column types. Pure schema — no queries, no services, no boot logic.
 *
 * WHAT IT IS NOT: it holds no business rules. The two custom column types that
 * needed app behaviour (encryption keys, the traefik config builder) take that
 * behaviour through `codecs/codec-registry`, which the APP configures at boot.
 * See that file for why the seam is deferred rather than a factory per table.
 *
 * WHY IT IS SHARED: the setup app reads `node_config` (local SQLite) to learn
 * the cluster decision, and the API reads the same table. Two definitions of a
 * table is two chances for the schema to drift; one definition cannot.
 */
// `local` and `global` both define a `clusterNodes` table (different databases),
// so a bare `export *` from each is ambiguous. The bare barrel therefore exports
// the CODECS only; consumers import a specific database's tables through its own
// subpath (`@repo/nest-schema/local/...` or `.../global/...`), which is also what
// makes the target database obvious at every call site.
export * from "./codecs/codec-registry";
