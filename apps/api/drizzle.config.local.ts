import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './src/config/drizzle/local-schema/index.ts',
    out: './src/config/drizzle/local-migrations',
    dialect: 'sqlite',
    dbCredentials: {
        url: process.env.NODE_LOCAL_DB_PATH ?? '/app/data/local.db',
    },
});
