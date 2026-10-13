// packages/nest/schema/src/global/docker-security-scan.ts
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
var dockerImageLifecycleStateEnum2 = pgEnum("docker_image_lifecycle_state", ["alive", "deleted"]);
var dockerImageSecurityScanStatusEnum2 = pgEnum("docker_image_security_scan_status", ["completed", "error"]);
var dockerImageSecurityScans2 = pgTable("docker_image_security_scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  imageId: text("image_id").notNull(),
  imageIdentifierNormalized: text("image_identifier_normalized").notNull(),
  imageGeneration: integer("image_generation").notNull().default(1),
  vulnerabilities: jsonb("vulnerabilities").$type().notNull(),
  scanSummary: jsonb("scan_summary").$type().notNull(),
  scanStatus: dockerImageSecurityScanStatusEnum2("scan_status").notNull().default("completed"),
  lastUpdated: timestamp("last_updated").$defaultFn(() => new Date).notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("docker_image_security_scans_identifier_generation_uidx").on(table.imageIdentifierNormalized, table.imageGeneration),
  index("docker_image_security_scans_image_idx").on(table.imageId),
  index("docker_image_security_scans_image_identifier_generation_idx").on(table.imageIdentifierNormalized, table.imageGeneration),
  index("docker_image_security_scans_last_updated_idx").on(table.lastUpdated)
]);
var dockerImageSecurityScanHistory2 = pgTable("docker_image_security_scan_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  imageId: text("image_id").notNull(),
  imageIdentifierNormalized: text("image_identifier_normalized").notNull(),
  imageGeneration: integer("image_generation").notNull().default(1),
  scanHash: text("scan_hash").notNull(),
  vulnerabilities: jsonb("vulnerabilities").$type().notNull(),
  scanSummary: jsonb("scan_summary").$type().notNull(),
  scanStatus: dockerImageSecurityScanStatusEnum2("scan_status").notNull().default("completed"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("docker_image_security_scan_history_scan_hash_uidx").on(table.scanHash),
  index("docker_image_security_scan_history_identifier_idx").on(table.imageIdentifierNormalized),
  index("docker_image_security_scan_history_generation_idx").on(table.imageIdentifierNormalized, table.imageGeneration),
  index("docker_image_security_scan_history_created_idx").on(table.createdAt)
]);
var dockerImageSecurityLifecycle2 = pgTable("docker_image_security_lifecycle", {
  id: uuid("id").primaryKey().defaultRandom(),
  imageIdentifierNormalized: text("image_identifier_normalized").notNull(),
  currentGeneration: integer("current_generation").notNull().default(1),
  lifecycleState: dockerImageLifecycleStateEnum2("lifecycle_state").notNull().default("alive"),
  firstSeenAt: timestamp("first_seen_at").$defaultFn(() => new Date).notNull(),
  lastSeenAt: timestamp("last_seen_at").$defaultFn(() => new Date).notNull(),
  deletedAt: timestamp("deleted_at"),
  revivedAt: timestamp("revived_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("docker_image_security_lifecycle_identifier_uidx").on(table.imageIdentifierNormalized),
  index("docker_image_security_lifecycle_state_idx").on(table.lifecycleState),
  index("docker_image_security_lifecycle_last_seen_idx").on(table.lastSeenAt)
]);

export { dockerImageLifecycleStateEnum2, dockerImageSecurityScanStatusEnum2, dockerImageSecurityScans2, dockerImageSecurityScanHistory2, dockerImageSecurityLifecycle2 };
