import { defineConfig } from "drizzle-kit";

/**
 * Global (Postgres) schema: the generator lives WITH the schema, so it keeps working when the
 * apps that used to host it are gone. `out` is the canonical migrations directory the runtime
 * migrator reads.
 */
export default defineConfig({
	schema: "./src/global/index.ts",
	out: "./migrations/global",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.SETUP_DATABASE_URL ?? "",
	},
});
