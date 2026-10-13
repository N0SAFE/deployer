import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Application configuration store.
 *
 * Key-value table for runtime-configurable application settings
 * that were previously environment variables (e.g. GitHub OAuth).
 * Values are JSON-encoded strings.
 */
export const appConfig = pgTable(
  'app_config',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    description: text('description'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    updatedBy: text('updated_by'),
  },
  (table) => [
    index('app_config_key_idx').on(table.key),
  ],
);
