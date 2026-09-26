import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    // The table definitions were extracted into `@repo/nest-schema` (commit
    // "extract @repo/nest-env and @repo/nest-schema"), which removed
    // `src/config/drizzle/local/schema/`. Point at the package source so
    // `db:local:generate` keeps resolving the same tables. Migrations still
    // belong to the app, so `out` is unchanged.
    schema: '../../packages/nest/schema/src/local/index.ts',
    out: '../../packages/nest/schema/migrations/local',
    dialect: 'sqlite',
    dbCredentials: {
        url: process.env.NODE_LOCAL_DB_PATH ?? '/app/data/local.db',
    },
});
