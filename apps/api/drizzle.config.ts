import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './src/core/modules/db/drizzle/migrations',
  schema: './src/core/modules/db/drizzle/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});