import { pgTable, text, timestamp, boolean, integer, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth";

export const coreEventStreams = pgTable("core_event_streams", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    namespace: text("namespace").notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    scope: text("scope").notNull().default("global"),
    scopeId: text("scope_id"),
    filters: jsonb("filters").$type<Record<string, unknown>>(),
    replayDefault: boolean("replay_default").default(true).notNull(),
    replayLimitDefault: integer("replay_limit_default").default(100).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});

export const coreEventStreamsRelations = relations(coreEventStreams, ({ one }) => ({
    createdByUser: one(user, {
        fields: [coreEventStreams.createdBy],
        references: [user.id],
    }),
}));

export const coreEventLogs = pgTable(
    "core_event_logs",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        namespace: text("namespace").notNull(),
        eventName: text("event_name").notNull(),
        eventKey: text("event_key").notNull(),
        sequence: integer("sequence").notNull(),
        input: jsonb("input").$type<Record<string, unknown>>().notNull(),
        output: jsonb("output").$type<Record<string, unknown>>().notNull(),
        emittedAt: timestamp("emitted_at")
            .$defaultFn(() => new Date())
            .notNull(),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        index("core_event_logs_namespace_idx").on(table.namespace),
        index("core_event_logs_event_name_idx").on(table.eventName),
        index("core_event_logs_event_key_idx").on(table.eventKey),
        index("core_event_logs_emitted_at_idx").on(table.emittedAt),
    ],
);
