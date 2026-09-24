import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Node-local platform settings (key/value) — persisted in the LOCAL SQLite
 * database, so they survive restarts and are available before the global
 * Postgres database is even reached.
 *
 * Keys (see PlatformIngressSettingsService):
 *   - "ingress.entry_port" — the host port the platform Traefik publishes
 *     (overrides DEPLOYER_TRAEFIK_HTTP_PORT). Setting a value ≠ 80 changes
 *     the public entry point; global domains / tunnels must account for it.
 */
export const platformSettings = sqliteTable("platform_settings", {
    /** Setting key (e.g. "ingress.entry_port"). */
    key: text("key").primaryKey(),
    /** Stringified value. */
    value: text("value").notNull(),
    /** ISO-8601 timestamp of last update. */
    updatedAt: text("updated_at").notNull(),
});

export type PlatformSettingsRow = typeof platformSettings.$inferSelect;
export type NewPlatformSettingsRow = typeof platformSettings.$inferInsert;