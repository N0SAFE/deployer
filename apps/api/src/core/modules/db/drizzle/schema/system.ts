import { pgTable, varchar, timestamp, boolean, json } from 'drizzle-orm/pg-core';
/**
 * System configuration and status tracking table
 * This is a singleton table that should only have one row
 */
export const systemStatus = pgTable('system_status', {
    id: varchar('id', { length: 50 }).primaryKey().default('system'),
    isSeeded: boolean('is_seeded').notNull().default(false),
    seedVersion: varchar('seed_version', { length: 20 }).default('1.0.0'),
    lastSeededAt: timestamp('last_seeded_at'),
    seedMetadata: json('seed_metadata').$type<{
        usersCount?: number;
        projectsCount?: number;
        servicesCount?: number;
        deploymentsCount?: number;
        localServicesCreated?: string[];
    }>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export type SystemStatus = typeof systemStatus.$inferSelect;
export type NewSystemStatus = typeof systemStatus.$inferInsert;
