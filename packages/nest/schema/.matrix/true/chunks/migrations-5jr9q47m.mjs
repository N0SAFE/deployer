// packages/nest/schema/src/global/docker-runtime-activity.ts
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
var dockerRuntimeActivityStatusEnum2 = pgEnum("docker_runtime_activity_status", [
  "queued",
  "running",
  "completed",
  "error",
  "info"
]);
var dockerRuntimeActivityCategoryEnum2 = pgEnum("docker_runtime_activity_category", [
  "image-scanning",
  "runtime-event"
]);
var dockerRuntimeActivitySeverityEnum2 = pgEnum("docker_runtime_activity_severity", [
  "info",
  "warning",
  "error"
]);
var dockerRuntimeActivities2 = pgTable("docker_runtime_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventFingerprint: text("event_fingerprint").notNull(),
  eventId: text("event_id"),
  flowId: text("flow_id").notNull(),
  dependsOnFlowId: text("depends_on_flow_id"),
  source: text("source").notNull(),
  action: text("action").notNull(),
  actorId: text("actor_id"),
  status: dockerRuntimeActivityStatusEnum2("status").notNull().default("info"),
  category: dockerRuntimeActivityCategoryEnum2("category").notNull().default("runtime-event"),
  severity: dockerRuntimeActivitySeverityEnum2("severity").notNull().default("info"),
  progress: integer("progress"),
  stage: text("stage"),
  scanner: text("scanner"),
  message: text("message"),
  actorAttributes: jsonb("actor_attributes").$type().notNull(),
  payload: jsonb("payload").$type().notNull(),
  raw: jsonb("raw").$type().notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("docker_runtime_activities_fingerprint_uidx").on(table.eventFingerprint),
  index("docker_runtime_activities_occurred_idx").on(table.occurredAt),
  index("docker_runtime_activities_flow_idx").on(table.flowId),
  index("docker_runtime_activities_category_idx").on(table.category),
  index("docker_runtime_activities_status_idx").on(table.status),
  index("docker_runtime_activities_source_action_idx").on(table.source, table.action)
]);

export { dockerRuntimeActivityStatusEnum2, dockerRuntimeActivityCategoryEnum2, dockerRuntimeActivitySeverityEnum2, dockerRuntimeActivities2 };
