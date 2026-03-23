import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { encryptedText } from "@/config/drizzle/custom-types/encrypted-text";
import { organization, user } from "./auth";

/**
 * Shared cluster-control schema.
 *
 * These tables are designed to live in the centralized/replicated cluster metadata DB,
 * so they intentionally avoid hard foreign-keys to local instance runtime/auth tables.
 */

export const clusterNodeStatusEnum = pgEnum("cluster_node_status", ["active", "suspect", "draining", "revoked"]);
export const clusterJoinGrantStatusEnum = pgEnum("cluster_join_grant_status", ["issued", "used", "expired", "revoked"]);
export const clusterSigningKeyStatusEnum = pgEnum("cluster_signing_key_status", ["active", "previous", "revoked"]);
export const resourceOwnershipStatusEnum = pgEnum("resource_ownership_status", ["active", "stale", "revoked"]);
export const clusterAllocationModeEnum = pgEnum("cluster_allocation_mode", ["dedicated_full", "dedicated_slice", "shared_slice"]);
export const clusterAdmissionRequestStatusEnum = pgEnum("cluster_admission_request_status", [
    "pending",
    "approved",
    "rejected",
    "cancelled",
]);

export const clusterNodes = pgTable(
    "cluster_nodes",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        clusterId: uuid("cluster_id").notNull(),
        nodeId: uuid("node_id").notNull(),
        serverUrl: text("server_url").notNull(),
        displayName: text("display_name"),
        status: clusterNodeStatusEnum("status").default("active").notNull(),
        healthy: boolean("healthy").default(true).notNull(),
        capabilities: jsonb("capabilities").$type<{
            roles?: ("edge" | "relay" | "partition-owner" | "observer")[];
            regions?: string[];
            zones?: string[];
            maxStreams?: number;
            maxQueueDepth?: number;
        }>(),
        maxCpuMillicores: integer("max_cpu_millicores"),
        maxMemoryMb: integer("max_memory_mb"),
        metadata: jsonb("metadata").$type<Record<string, unknown>>(),
        enrolledAt: timestamp("enrolled_at")
            .$defaultFn(() => new Date())
            .notNull(),
        lastSeenAt: timestamp("last_seen_at"),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: timestamp("updated_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        unique("cluster_nodes_node_id_unique").on(table.nodeId),
        index("cluster_nodes_cluster_status_idx").on(table.clusterId, table.status),
    ],
);

export const clusterJoinGrants = pgTable(
    "cluster_join_grants",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        clusterId: uuid("cluster_id").notNull(),
        organizationId: text("organization_id").references(() => organization.id, { onDelete: "set null" }),
        grantTokenHash: text("grant_token_hash").notNull(),
        status: clusterJoinGrantStatusEnum("status").default("issued").notNull(),
        issuedByUserId: text("issued_by_user_id").references(() => user.id, { onDelete: "set null" }),
        targetNodeId: uuid("target_node_id"),
        expiresAt: timestamp("expires_at").notNull(),
        usedAt: timestamp("used_at"),
        revokedAt: timestamp("revoked_at"),
        metadata: jsonb("metadata").$type<Record<string, unknown>>(),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: timestamp("updated_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("cluster_join_grants_token_hash_uidx").on(table.grantTokenHash),
        index("cluster_join_grants_cluster_status_idx").on(table.clusterId, table.status),
        index("cluster_join_grants_expires_at_idx").on(table.expiresAt),
    ],
);

export const clusterSigningKeys = pgTable(
    "cluster_signing_keys",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        clusterId: uuid("cluster_id").notNull(),
        kid: text("kid").notNull(),
        algorithm: text("algorithm").default("HS256").notNull(),
        status: clusterSigningKeyStatusEnum("status").default("active").notNull(),
        secretMaterial: encryptedText("secret_material").notNull(),
        publicJwk: jsonb("public_jwk").$type<Record<string, unknown>>(),
        activatedAt: timestamp("activated_at")
            .$defaultFn(() => new Date())
            .notNull(),
        expiresAt: timestamp("expires_at"),
        rotatedAt: timestamp("rotated_at"),
        revokedAt: timestamp("revoked_at"),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: timestamp("updated_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("cluster_signing_keys_kid_uidx").on(table.kid),
        index("cluster_signing_keys_cluster_status_idx").on(table.clusterId, table.status),
    ],
);

export const clusterNodeMetrics = pgTable(
    "cluster_node_metrics",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        clusterId: uuid("cluster_id").notNull(),
        nodeId: uuid("node_id")
            .notNull()
            .references(() => clusterNodes.nodeId, { onDelete: "cascade" }),
        organizationId: text("organization_id").references(() => organization.id, { onDelete: "set null" }),
        metrics: jsonb("metrics")
            .$type<{
                cpuUsage: number;
                memoryUsage: number;
                activeStreams: number;
                queueDepth: number;
                errorRate?: number;
            }>()
            .notNull(),
        metricVersion: integer("metric_version").default(1).notNull(),
        reportedAt: timestamp("reported_at").notNull(),
        expiresAt: timestamp("expires_at"),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        index("cluster_node_metrics_cluster_node_reported_idx").on(table.clusterId, table.nodeId, table.reportedAt),
        index("cluster_node_metrics_org_reported_idx").on(table.organizationId, table.reportedAt),
    ],
);

export const resourceOwnershipIndex = pgTable(
    "resource_ownership_index",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        clusterId: uuid("cluster_id").notNull(),
        organizationId: text("organization_id").references(() => organization.id, { onDelete: "set null" }),
        resourceKind: text("resource_kind").notNull(),
        resourceKey: text("resource_key").notNull(),
        ownerNodeId: uuid("owner_node_id")
            .notNull()
            .references(() => clusterNodes.nodeId, { onDelete: "cascade" }),
        ownerServerUrl: text("owner_server_url"),
        priority: integer("priority").default(0).notNull(),
        status: resourceOwnershipStatusEnum("status").default("active").notNull(),
        leaseHolderNodeId: uuid("lease_holder_node_id").references(() => clusterNodes.nodeId, { onDelete: "set null" }),
        leaseExpiresAt: timestamp("lease_expires_at"),
        version: integer("version").default(1).notNull(),
        metadata: jsonb("metadata").$type<Record<string, unknown>>(),
        observedAt: timestamp("observed_at")
            .$defaultFn(() => new Date())
            .notNull(),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: timestamp("updated_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("resource_ownership_index_unique_owner_uidx").on(
            table.clusterId,
            table.organizationId,
            table.resourceKind,
            table.resourceKey,
            table.ownerNodeId,
        ),
        index("resource_ownership_index_lookup_idx").on(
            table.clusterId,
            table.organizationId,
            table.resourceKind,
            table.resourceKey,
            table.status,
        ),
        index("resource_ownership_index_owner_node_idx").on(table.ownerNodeId),
    ],
);

export const clusterOrgServerAllocations = pgTable(
    "cluster_org_server_allocations",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        clusterId: uuid("cluster_id").notNull(),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        serverNodeId: uuid("server_node_id")
            .notNull()
            .references(() => clusterNodes.nodeId, { onDelete: "cascade" }),
        allocationMode: clusterAllocationModeEnum("allocation_mode").default("shared_slice").notNull(),
        cpuMillicores: integer("cpu_millicores").default(0).notNull(),
        memoryMb: integer("memory_mb").default(0).notNull(),
        maxServices: integer("max_services"),
        isEnabled: boolean("is_enabled").default(true).notNull(),
        createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: timestamp("updated_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("cluster_org_server_allocations_unique_uidx").on(
            table.clusterId,
            table.organizationId,
            table.serverNodeId,
        ),
        index("cluster_org_server_allocations_org_idx").on(table.organizationId, table.updatedAt),
        index("cluster_org_server_allocations_server_idx").on(table.serverNodeId, table.updatedAt),
    ],
);

export const clusterOrgAdmissionRequests = pgTable(
    "cluster_org_admission_requests",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        clusterId: uuid("cluster_id").notNull(),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        status: clusterAdmissionRequestStatusEnum("status").default("pending").notNull(),
        requestedServerNodeId: uuid("requested_server_node_id").references(() => clusterNodes.nodeId, {
            onDelete: "set null",
        }),
        decisionServerNodeId: uuid("decision_server_node_id").references(() => clusterNodes.nodeId, {
            onDelete: "set null",
        }),
        requestedCpuMillicores: integer("requested_cpu_millicores").default(0).notNull(),
        requestedMemoryMb: integer("requested_memory_mb").default(0).notNull(),
        requestedServices: integer("requested_services").default(1).notNull(),
        requesterUserId: text("requester_user_id").references(() => user.id, { onDelete: "set null" }),
        requesterNote: text("requester_note"),
        reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, { onDelete: "set null" }),
        reviewerNote: text("reviewer_note"),
        reviewedAt: timestamp("reviewed_at"),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: timestamp("updated_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        index("cluster_org_admission_requests_org_status_idx").on(table.organizationId, table.status, table.updatedAt),
        index("cluster_org_admission_requests_status_idx").on(table.status, table.updatedAt),
        index("cluster_org_admission_requests_cluster_idx").on(table.clusterId, table.updatedAt),
    ],
);

export const clusterNodesRelations = relations(clusterNodes, ({ many }) => ({
    metrics: many(clusterNodeMetrics),
    ownedResources: many(resourceOwnershipIndex, { relationName: "resourceOwnershipOwner" }),
    leaseResources: many(resourceOwnershipIndex, { relationName: "resourceOwnershipLeaseHolder" }),
}));

export const clusterNodeMetricsRelations = relations(clusterNodeMetrics, ({ one }) => ({
    node: one(clusterNodes, {
        fields: [clusterNodeMetrics.nodeId],
        references: [clusterNodes.nodeId],
    }),
    organization: one(organization, {
        fields: [clusterNodeMetrics.organizationId],
        references: [organization.id],
    }),
}));

export const resourceOwnershipIndexRelations = relations(resourceOwnershipIndex, ({ one }) => ({
    ownerNode: one(clusterNodes, {
        fields: [resourceOwnershipIndex.ownerNodeId],
        references: [clusterNodes.nodeId],
        relationName: "resourceOwnershipOwner",
    }),
    leaseHolderNode: one(clusterNodes, {
        fields: [resourceOwnershipIndex.leaseHolderNodeId],
        references: [clusterNodes.nodeId],
        relationName: "resourceOwnershipLeaseHolder",
    }),
    organization: one(organization, {
        fields: [resourceOwnershipIndex.organizationId],
        references: [organization.id],
    }),
}));

export const clusterJoinGrantsRelations = relations(clusterJoinGrants, ({ one }) => ({
    issuedBy: one(user, {
        fields: [clusterJoinGrants.issuedByUserId],
        references: [user.id],
    }),
    organization: one(organization, {
        fields: [clusterJoinGrants.organizationId],
        references: [organization.id],
    }),
}));

export const clusterOrgServerAllocationsRelations = relations(clusterOrgServerAllocations, ({ one }) => ({
    organization: one(organization, {
        fields: [clusterOrgServerAllocations.organizationId],
        references: [organization.id],
    }),
    serverNode: one(clusterNodes, {
        fields: [clusterOrgServerAllocations.serverNodeId],
        references: [clusterNodes.nodeId],
    }),
    createdBy: one(user, {
        fields: [clusterOrgServerAllocations.createdByUserId],
        references: [user.id],
    }),
}));

export const clusterOrgAdmissionRequestsRelations = relations(clusterOrgAdmissionRequests, ({ one }) => ({
    organization: one(organization, {
        fields: [clusterOrgAdmissionRequests.organizationId],
        references: [organization.id],
    }),
    requestedServerNode: one(clusterNodes, {
        fields: [clusterOrgAdmissionRequests.requestedServerNodeId],
        references: [clusterNodes.nodeId],
    }),
    decisionServerNode: one(clusterNodes, {
        fields: [clusterOrgAdmissionRequests.decisionServerNodeId],
        references: [clusterNodes.nodeId],
    }),
    requester: one(user, {
        fields: [clusterOrgAdmissionRequests.requesterUserId],
        references: [user.id],
    }),
    reviewer: one(user, {
        fields: [clusterOrgAdmissionRequests.reviewedByUserId],
        references: [user.id],
    }),
}));