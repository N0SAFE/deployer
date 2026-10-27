import { defineConfig } from "drizzle-kit";

/** Local (per-node SQLite) schema. */
export default defineConfig({
	schema: "./src/local/index.ts",
	out: "./migrations/local",
	dialect: "sqlite",
	dbCredentials: {
		url: process.env.NODE_LOCAL_DB_PATH ?? "/app/data/local.db",
	},
});
