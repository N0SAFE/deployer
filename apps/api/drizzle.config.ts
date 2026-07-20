import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    schema: './src/config/drizzle/global/schema/index.ts',
    out: './src/config/drizzle/global/migrations',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.SETUP_DATABASE_URL || '',
    }
})