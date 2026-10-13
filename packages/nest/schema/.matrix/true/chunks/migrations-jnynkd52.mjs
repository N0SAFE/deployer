import {
  user2
} from "./migrations-qcwa49zw.mjs";

// packages/nest/schema/src/global/events.ts
import { pgTable, text, timestamp, boolean, integer, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
var coreEventStreams2 = pgTable("core_event_streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  namespace: text("namespace").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  scope: text("scope").notNull().default("global"),
  scopeId: text("scope_id"),
  filters: jsonb("filters").$type(),
  replayDefault: boolean("replay_default").default(true).notNull(),
  replayLimitDefault: integer("replay_limit_default").default(100).notNull(),
  createdBy: text("created_by").references(() => user2.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
});
var coreEventStreamsRelations2 = relations(coreEventStreams2, ({ one }) => ({
  createdByUser: one(user2, {
    fields: [coreEventStreams2.createdBy],
    references: [user2.id]
  })
}));
var coreEventLogs2 = pgTable("core_event_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  namespace: text("namespace").notNull(),
  eventName: text("event_name").notNull(),
  eventKey: text("event_key").notNull(),
  sequence: integer("sequence").notNull(),
  input: jsonb("input").$type().notNull(),
  output: jsonb("output").$type().notNull(),
  emittedAt: timestamp("emitted_at").$defaultFn(() => new Date).notNull(),
  createdAt: timestamp("created_at").defaultNow().$defaultFn(() => new Date).notNull()
}, (table) => [
  index("core_event_logs_namespace_idx").on(table.namespace),
  index("core_event_logs_event_name_idx").on(table.eventName),
  index("core_event_logs_event_key_idx").on(table.eventKey),
  index("core_event_logs_emitted_at_idx").on(table.emittedAt)
]);

export { coreEventStreams2, coreEventStreamsRelations2, coreEventLogs2 };
