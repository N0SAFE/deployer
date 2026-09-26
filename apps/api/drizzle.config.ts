import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    // The table definitions were extracted into `@repo/nest-schema` (commit
    // "extract @repo/nest-env and @repo/nest-schema"), which removed
    // `src/config/drizzle/global/schema/`. Point at the package source so
    // `db:global:generate` keeps resolving the same tables. Migrations still
    // belong to the app, so `out` is unchanged.
    schema: '../../packages/nest/schema/src/global/index.ts',
    out: './src/config/drizzle/global/migrations',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.SETUP_DATABASE_URL || '',
    }
})