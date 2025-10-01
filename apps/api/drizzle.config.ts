import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './src/config/drizzle/migrations',
  schema: './src/config/drizzle/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});