// packages/nest/schema/src/global/cluster.ts
import { relations as relations2 } from "drizzle-orm";
import { boolean as boolean2, index as index2, integer as integer2, jsonb, pgEnum, pgTable as pgTable2, text as text2, timestamp as timestamp2, unique, uniqueIndex as uniqueIndex2, uuid } from "drizzle-orm/pg-core";
import { encryptedText } from "@deployer/nest-schema/codecs/codec-registry";

// packages/nest/schema/src/global/auth.ts
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
var user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull(),
  role: text("role").default("user").notNull(),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false)
});
var session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by")
}, (table) => [index("session_userId_idx").on(table.userId)]);
var account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull()
}, (table) => [index("account_userId_idx").on(table.userId)]);
var verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull()
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);
var platformInvite = pgTable("platform_invite", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  invitedUserId: text("invited_user_id").notNull().references(() => user.id, { onDelete: "cascade" })
});
var userVapidKeys = pgTable("user_vapid_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  subject: text("subject"),
  createdAt: timestamp("created_at").notNull()
});
var pushSubscription = pgTable("push_subscription", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceName: text("device_name"),
  userAgent: text("user_agent"),
  isActive: boolean("is_active").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  lastUsedAt: timestamp("last_used_at")
});
var apikey = pgTable("apikey", {
  id: text("id").primaryKey(),
  configId: text("config_id").default("default").notNull(),
  name: text("name"),
  start: text("start"),
  referenceId: text("reference_id").notNull(),
  prefix: text("prefix"),
  key: text("key").notNull(),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at"),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: integer("rate_limit_time_window").default(3600000),
  rateLimitMax: integer("rate_limit_max").default(1000),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  permissions: text("permissions"),
  metadata: text("metadata")
}, (table) => [
  index("apikey_configId_idx").on(table.configId),
  index("apikey_referenceId_idx").on(table.referenceId),
  index("apikey_key_idx").on(table.key)
]);
var passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at"),
  aaguid: text("aaguid")
}, (table) => [
  index("passkey_userId_idx").on(table.userId),
  index("passkey_credentialID_idx").on(table.credentialID)
]);
var twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: timestamp("locked_until")
}, (table) => [
  index("twoFactor_secret_idx").on(table.secret),
  index("twoFactor_userId_idx").on(table.userId)
]);
var deviceCode = pgTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull(),
  userCode: text("user_code").notNull(),
  userId: text("user_id"),
  expiresAt: timestamp("expires_at").notNull(),
  status: text("status").notNull(),
  lastPolledAt: timestamp("last_polled_at"),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope")
}, (table) => [
  uniqueIndex("deviceCode_deviceCode_uidx").on(table.deviceCode),
  uniqueIndex("deviceCode_userCode_uidx").on(table.userCode)
]);
var userRelations = relations(user, ({ one, many }) => ({
  sessions: many(session),
  accounts: many(account),
  platformInvites: many(platformInvite),
  userVapidKeys: one(userVapidKeys),
  pushSubscriptions: many(pushSubscription),
  passkeys: many(passkey),
  twoFactors: many(twoFactor)
}));
var sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id]
  })
}));
var accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id]
  })
}));
var platformInviteRelations = relations(platformInvite, ({ one }) => ({
  user: one(user, {
    fields: [platformInvite.invitedUserId],
    references: [user.id]
  })
}));
var userVapidKeysRelations = relations(userVapidKeys, ({ one }) => ({
  user: one(user, {
    fields: [userVapidKeys.userId],
    references: [user.id]
  })
}));
var pushSubscriptionRelations = relations(pushSubscription, ({ one }) => ({
  user: one(user, {
    fields: [pushSubscription.userId],
    references: [user.id]
  })
}));

// packages/nest/schema/src/global/cluster.ts
var clusterNodeStatusEnum = pgEnum("cluster_node_status", ["active", "suspect", "draining", "revoked"]);
var clusterJoinGrantStatusEnum = pgEnum("cluster_join_grant_status", ["issued", "used", "expired", "revoked"]);
var clusterSigningKeyStatusEnum = pgEnum("cluster_signing_key_status", ["active", "previous", "revoked"]);
var resourceOwnershipStatusEnum = pgEnum("resource_ownership_status", ["active", "stale", "revoked"]);
var clusterAllocationModeEnum = pgEnum("cluster_allocation_mode", ["dedicated_full", "dedicated_slice", "shared_slice"]);
var clusterAdmissionRequestStatusEnum = pgEnum("cluster_admission_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled"
]);
var clusterNodes = pgTable2("cluster_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  nodeId: text2("node_id").notNull(),
  serverUrl: text2("server_url").notNull(),
  displayName: text2("display_name"),
  status: clusterNodeStatusEnum("status").default("active").notNull(),
  healthy: boolean2("healthy").default(true).notNull(),
  capabilities: jsonb("capabilities").$type(),
  maxCpuMillicores: integer2("max_cpu_millicores"),
  maxMemoryMb: integer2("max_memory_mb"),
  metadata: jsonb("metadata").$type(),
  enrolledAt: timestamp2("enrolled_at").$defaultFn(() => new Date).notNull(),
  swarmNodeId: text2("swarm_node_id"),
  lastSeenAt: timestamp2("last_seen_at"),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  unique("cluster_nodes_node_id_unique").on(table.nodeId),
  index2("cluster_nodes_cluster_status_idx").on(table.status)
]);
var clusterJoinGrants = pgTable2("cluster_join_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  grantTokenHash: text2("grant_token_hash").notNull(),
  status: clusterJoinGrantStatusEnum("status").default("issued").notNull(),
  issuedByUserId: text2("issued_by_user_id").references(() => user.id, { onDelete: "set null" }),
  targetNodeId: text2("target_node_id"),
  expiresAt: timestamp2("expires_at").notNull(),
  usedAt: timestamp2("used_at"),
  revokedAt: timestamp2("revoked_at"),
  metadata: jsonb("metadata").$type(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex2("cluster_join_grants_token_hash_uidx").on(table.grantTokenHash),
  index2("cluster_join_grants_cluster_status_idx").on(table.status),
  index2("cluster_join_grants_expires_at_idx").on(table.expiresAt)
]);
var clusterSigningKeys = pgTable2("cluster_signing_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  kid: text2("kid").notNull(),
  algorithm: text2("algorithm").default("HS256").notNull(),
  status: clusterSigningKeyStatusEnum("status").default("active").notNull(),
  secretMaterial: encryptedText("secret_material").notNull(),
  publicJwk: jsonb("public_jwk").$type(),
  activatedAt: timestamp2("activated_at").$defaultFn(() => new Date).notNull(),
  expiresAt: timestamp2("expires_at"),
  rotatedAt: timestamp2("rotated_at"),
  revokedAt: timestamp2("revoked_at"),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex2("cluster_signing_keys_kid_uidx").on(table.kid),
  index2("cluster_signing_keys_cluster_status_idx").on(table.status)
]);
var clusterNodeMetrics = pgTable2("cluster_node_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  nodeId: text2("node_id").notNull().references(() => clusterNodes.nodeId, { onDelete: "cascade" }),
  metrics: jsonb("metrics").$type().notNull(),
  metricVersion: integer2("metric_version").default(1).notNull(),
  reportedAt: timestamp2("reported_at").notNull(),
  expiresAt: timestamp2("expires_at"),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  index2("cluster_node_metrics_cluster_node_reported_idx").on(table.nodeId, table.reportedAt)
]);
var resourceOwnershipIndex = pgTable2("resource_ownership_index", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceKind: text2("resource_kind").notNull(),
  resourceKey: text2("resource_key").notNull(),
  ownerNodeId: text2("owner_node_id").notNull().references(() => clusterNodes.nodeId, { onDelete: "cascade" }),
  ownerServerUrl: text2("owner_server_url"),
  priority: integer2("priority").default(0).notNull(),
  status: resourceOwnershipStatusEnum("status").default("active").notNull(),
  leaseHolderNodeId: text2("lease_holder_node_id").references(() => clusterNodes.nodeId, { onDelete: "set null" }),
  leaseExpiresAt: timestamp2("lease_expires_at"),
  version: integer2("version").default(1).notNull(),
  metadata: jsonb("metadata").$type(),
  observedAt: timestamp2("observed_at").$defaultFn(() => new Date).notNull(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex2("resource_ownership_index_unique_owner_uidx").on(table.resourceKind, table.resourceKey, table.ownerNodeId),
  index2("resource_ownership_index_lookup_idx").on(table.resourceKind, table.resourceKey, table.status),
  index2("resource_ownership_index_owner_node_idx").on(table.ownerNodeId)
]);
var clusterServerAllocations = pgTable2("cluster_server_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  serverNodeId: text2("server_node_id").notNull().references(() => clusterNodes.nodeId, { onDelete: "cascade" }),
  allocationMode: clusterAllocationModeEnum("allocation_mode").default("shared_slice").notNull(),
  cpuMillicores: integer2("cpu_millicores").default(0).notNull(),
  memoryMb: integer2("memory_mb").default(0).notNull(),
  maxServices: integer2("max_services"),
  isEnabled: boolean2("is_enabled").default(true).notNull(),
  createdByUserId: text2("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex2("cluster_server_allocations_unique_uidx").on(table.serverNodeId),
  index2("cluster_server_allocations_server_idx").on(table.serverNodeId, table.updatedAt)
]);
var clusterAdmissionRequests = pgTable2("cluster_admission_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: clusterAdmissionRequestStatusEnum("status").default("pending").notNull(),
  requestedServerNodeId: text2("requested_server_node_id").references(() => clusterNodes.nodeId, {
    onDelete: "set null"
  }),
  decisionServerNodeId: text2("decision_server_node_id").references(() => clusterNodes.nodeId, {
    onDelete: "set null"
  }),
  requestedCpuMillicores: integer2("requested_cpu_millicores").default(0).notNull(),
  requestedMemoryMb: integer2("requested_memory_mb").default(0).notNull(),
  requestedServices: integer2("requested_services").default(1).notNull(),
  requesterUserId: text2("requester_user_id").references(() => user.id, { onDelete: "set null" }),
  requesterNote: text2("requester_note"),
  reviewedByUserId: text2("reviewed_by_user_id").references(() => user.id, { onDelete: "set null" }),
  reviewerNote: text2("reviewer_note"),
  reviewedAt: timestamp2("reviewed_at"),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  index2("cluster_admission_requests_status_idx").on(table.status, table.updatedAt),
  index2("cluster_admission_requests_cluster_idx").on(table.updatedAt)
]);
var clusterNodesRelations = relations2(clusterNodes, ({ many }) => ({
  metrics: many(clusterNodeMetrics),
  ownedResources: many(resourceOwnershipIndex, { relationName: "resourceOwnershipOwner" }),
  leaseResources: many(resourceOwnershipIndex, { relationName: "resourceOwnershipLeaseHolder" })
}));
var clusterNodeMetricsRelations = relations2(clusterNodeMetrics, ({ one }) => ({
  node: one(clusterNodes, {
    fields: [clusterNodeMetrics.nodeId],
    references: [clusterNodes.nodeId]
  })
}));
var resourceOwnershipIndexRelations = relations2(resourceOwnershipIndex, ({ one }) => ({
  ownerNode: one(clusterNodes, {
    fields: [resourceOwnershipIndex.ownerNodeId],
    references: [clusterNodes.nodeId],
    relationName: "resourceOwnershipOwner"
  }),
  leaseHolderNode: one(clusterNodes, {
    fields: [resourceOwnershipIndex.leaseHolderNodeId],
    references: [clusterNodes.nodeId],
    relationName: "resourceOwnershipLeaseHolder"
  })
}));
var clusterJoinGrantsRelations = relations2(clusterJoinGrants, ({ one }) => ({
  issuedBy: one(user, {
    fields: [clusterJoinGrants.issuedByUserId],
    references: [user.id]
  })
}));
var clusterServerAllocationsRelations = relations2(clusterServerAllocations, ({ one }) => ({
  serverNode: one(clusterNodes, {
    fields: [clusterServerAllocations.serverNodeId],
    references: [clusterNodes.nodeId]
  }),
  createdBy: one(user, {
    fields: [clusterServerAllocations.createdByUserId],
    references: [user.id]
  })
}));
var clusterAdmissionRequestsRelations = relations2(clusterAdmissionRequests, ({ one }) => ({
  requestedServerNode: one(clusterNodes, {
    fields: [clusterAdmissionRequests.requestedServerNodeId],
    references: [clusterNodes.nodeId]
  }),
  decisionServerNode: one(clusterNodes, {
    fields: [clusterAdmissionRequests.decisionServerNodeId],
    references: [clusterNodes.nodeId]
  }),
  requester: one(user, {
    fields: [clusterAdmissionRequests.requesterUserId],
    references: [user.id]
  }),
  reviewer: one(user, {
    fields: [clusterAdmissionRequests.reviewedByUserId],
    references: [user.id]
  })
}));
export {
  clusterAdmissionRequestStatusEnum,
  clusterAdmissionRequests,
  clusterAdmissionRequestsRelations,
  clusterAllocationModeEnum,
  clusterJoinGrantStatusEnum,
  clusterJoinGrants,
  clusterJoinGrantsRelations,
  clusterNodeMetrics,
  clusterNodeMetricsRelations,
  clusterNodeStatusEnum,
  clusterNodes,
  clusterNodesRelations,
  clusterServerAllocations,
  clusterServerAllocationsRelations,
  clusterSigningKeyStatusEnum,
  clusterSigningKeys,
  resourceOwnershipIndex,
  resourceOwnershipIndexRelations,
  resourceOwnershipStatusEnum
};
