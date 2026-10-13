import {
  user2
} from "./migrations-qcwa49zw.mjs";

// packages/nest/schema/src/global/cluster.ts
import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { encryptedText } from "@deployer/nest-schema/codecs/codec-registry";
var clusterNodeStatusEnum2 = pgEnum("cluster_node_status", ["active", "suspect", "draining", "revoked"]);
var clusterJoinGrantStatusEnum2 = pgEnum("cluster_join_grant_status", ["issued", "used", "expired", "revoked"]);
var clusterSigningKeyStatusEnum2 = pgEnum("cluster_signing_key_status", ["active", "previous", "revoked"]);
var resourceOwnershipStatusEnum2 = pgEnum("resource_ownership_status", ["active", "stale", "revoked"]);
var clusterAllocationModeEnum2 = pgEnum("cluster_allocation_mode", ["dedicated_full", "dedicated_slice", "shared_slice"]);
var clusterAdmissionRequestStatusEnum2 = pgEnum("cluster_admission_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled"
]);
var clusterNodes2 = pgTable("cluster_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  nodeId: text("node_id").notNull(),
  serverUrl: text("server_url").notNull(),
  displayName: text("display_name"),
  status: clusterNodeStatusEnum2("status").default("active").notNull(),
  healthy: boolean("healthy").default(true).notNull(),
  capabilities: jsonb("capabilities").$type(),
  maxCpuMillicores: integer("max_cpu_millicores"),
  maxMemoryMb: integer("max_memory_mb"),
  metadata: jsonb("metadata").$type(),
  enrolledAt: timestamp("enrolled_at").$defaultFn(() => new Date).notNull(),
  swarmNodeId: text("swarm_node_id"),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  unique("cluster_nodes_node_id_unique").on(table.nodeId),
  index("cluster_nodes_cluster_status_idx").on(table.status)
]);
var clusterJoinGrants2 = pgTable("cluster_join_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  grantTokenHash: text("grant_token_hash").notNull(),
  status: clusterJoinGrantStatusEnum2("status").default("issued").notNull(),
  issuedByUserId: text("issued_by_user_id").references(() => user2.id, { onDelete: "set null" }),
  targetNodeId: text("target_node_id"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  revokedAt: timestamp("revoked_at"),
  metadata: jsonb("metadata").$type(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("cluster_join_grants_token_hash_uidx").on(table.grantTokenHash),
  index("cluster_join_grants_cluster_status_idx").on(table.status),
  index("cluster_join_grants_expires_at_idx").on(table.expiresAt)
]);
var clusterSigningKeys2 = pgTable("cluster_signing_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  kid: text("kid").notNull(),
  algorithm: text("algorithm").default("HS256").notNull(),
  status: clusterSigningKeyStatusEnum2("status").default("active").notNull(),
  secretMaterial: encryptedText("secret_material").notNull(),
  publicJwk: jsonb("public_jwk").$type(),
  activatedAt: timestamp("activated_at").$defaultFn(() => new Date).notNull(),
  expiresAt: timestamp("expires_at"),
  rotatedAt: timestamp("rotated_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("cluster_signing_keys_kid_uidx").on(table.kid),
  index("cluster_signing_keys_cluster_status_idx").on(table.status)
]);
var clusterNodeMetrics2 = pgTable("cluster_node_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  nodeId: text("node_id").notNull().references(() => clusterNodes2.nodeId, { onDelete: "cascade" }),
  metrics: jsonb("metrics").$type().notNull(),
  metricVersion: integer("metric_version").default(1).notNull(),
  reportedAt: timestamp("reported_at").notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  index("cluster_node_metrics_cluster_node_reported_idx").on(table.nodeId, table.reportedAt)
]);
var resourceOwnershipIndex2 = pgTable("resource_ownership_index", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceKind: text("resource_kind").notNull(),
  resourceKey: text("resource_key").notNull(),
  ownerNodeId: text("owner_node_id").notNull().references(() => clusterNodes2.nodeId, { onDelete: "cascade" }),
  ownerServerUrl: text("owner_server_url"),
  priority: integer("priority").default(0).notNull(),
  status: resourceOwnershipStatusEnum2("status").default("active").notNull(),
  leaseHolderNodeId: text("lease_holder_node_id").references(() => clusterNodes2.nodeId, { onDelete: "set null" }),
  leaseExpiresAt: timestamp("lease_expires_at"),
  version: integer("version").default(1).notNull(),
  metadata: jsonb("metadata").$type(),
  observedAt: timestamp("observed_at").$defaultFn(() => new Date).notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("resource_ownership_index_unique_owner_uidx").on(table.resourceKind, table.resourceKey, table.ownerNodeId),
  index("resource_ownership_index_lookup_idx").on(table.resourceKind, table.resourceKey, table.status),
  index("resource_ownership_index_owner_node_idx").on(table.ownerNodeId)
]);
var clusterServerAllocations2 = pgTable("cluster_server_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  serverNodeId: text("server_node_id").notNull().references(() => clusterNodes2.nodeId, { onDelete: "cascade" }),
  allocationMode: clusterAllocationModeEnum2("allocation_mode").default("shared_slice").notNull(),
  cpuMillicores: integer("cpu_millicores").default(0).notNull(),
  memoryMb: integer("memory_mb").default(0).notNull(),
  maxServices: integer("max_services"),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdByUserId: text("created_by_user_id").references(() => user2.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("cluster_server_allocations_unique_uidx").on(table.serverNodeId),
  index("cluster_server_allocations_server_idx").on(table.serverNodeId, table.updatedAt)
]);
var clusterAdmissionRequests2 = pgTable("cluster_admission_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: clusterAdmissionRequestStatusEnum2("status").default("pending").notNull(),
  requestedServerNodeId: text("requested_server_node_id").references(() => clusterNodes2.nodeId, {
    onDelete: "set null"
  }),
  decisionServerNodeId: text("decision_server_node_id").references(() => clusterNodes2.nodeId, {
    onDelete: "set null"
  }),
  requestedCpuMillicores: integer("requested_cpu_millicores").default(0).notNull(),
  requestedMemoryMb: integer("requested_memory_mb").default(0).notNull(),
  requestedServices: integer("requested_services").default(1).notNull(),
  requesterUserId: text("requester_user_id").references(() => user2.id, { onDelete: "set null" }),
  requesterNote: text("requester_note"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => user2.id, { onDelete: "set null" }),
  reviewerNote: text("reviewer_note"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  index("cluster_admission_requests_status_idx").on(table.status, table.updatedAt),
  index("cluster_admission_requests_cluster_idx").on(table.updatedAt)
]);
var clusterNodesRelations2 = relations(clusterNodes2, ({ many }) => ({
  metrics: many(clusterNodeMetrics2),
  ownedResources: many(resourceOwnershipIndex2, { relationName: "resourceOwnershipOwner" }),
  leaseResources: many(resourceOwnershipIndex2, { relationName: "resourceOwnershipLeaseHolder" })
}));
var clusterNodeMetricsRelations2 = relations(clusterNodeMetrics2, ({ one }) => ({
  node: one(clusterNodes2, {
    fields: [clusterNodeMetrics2.nodeId],
    references: [clusterNodes2.nodeId]
  })
}));
var resourceOwnershipIndexRelations2 = relations(resourceOwnershipIndex2, ({ one }) => ({
  ownerNode: one(clusterNodes2, {
    fields: [resourceOwnershipIndex2.ownerNodeId],
    references: [clusterNodes2.nodeId],
    relationName: "resourceOwnershipOwner"
  }),
  leaseHolderNode: one(clusterNodes2, {
    fields: [resourceOwnershipIndex2.leaseHolderNodeId],
    references: [clusterNodes2.nodeId],
    relationName: "resourceOwnershipLeaseHolder"
  })
}));
var clusterJoinGrantsRelations2 = relations(clusterJoinGrants2, ({ one }) => ({
  issuedBy: one(user2, {
    fields: [clusterJoinGrants2.issuedByUserId],
    references: [user2.id]
  })
}));
var clusterServerAllocationsRelations2 = relations(clusterServerAllocations2, ({ one }) => ({
  serverNode: one(clusterNodes2, {
    fields: [clusterServerAllocations2.serverNodeId],
    references: [clusterNodes2.nodeId]
  }),
  createdBy: one(user2, {
    fields: [clusterServerAllocations2.createdByUserId],
    references: [user2.id]
  })
}));
var clusterAdmissionRequestsRelations2 = relations(clusterAdmissionRequests2, ({ one }) => ({
  requestedServerNode: one(clusterNodes2, {
    fields: [clusterAdmissionRequests2.requestedServerNodeId],
    references: [clusterNodes2.nodeId]
  }),
  decisionServerNode: one(clusterNodes2, {
    fields: [clusterAdmissionRequests2.decisionServerNodeId],
    references: [clusterNodes2.nodeId]
  }),
  requester: one(user2, {
    fields: [clusterAdmissionRequests2.requesterUserId],
    references: [user2.id]
  }),
  reviewer: one(user2, {
    fields: [clusterAdmissionRequests2.reviewedByUserId],
    references: [user2.id]
  })
}));

export { clusterNodeStatusEnum2, clusterJoinGrantStatusEnum2, clusterSigningKeyStatusEnum2, resourceOwnershipStatusEnum2, clusterAllocationModeEnum2, clusterAdmissionRequestStatusEnum2, clusterNodes2, clusterJoinGrants2, clusterSigningKeys2, clusterNodeMetrics2, resourceOwnershipIndex2, clusterServerAllocations2, clusterAdmissionRequests2, clusterNodesRelations2, clusterNodeMetricsRelations2, resourceOwnershipIndexRelations2, clusterJoinGrantsRelations2, clusterServerAllocationsRelations2, clusterAdmissionRequestsRelations2 };
