import { pgTable, text, timestamp, boolean, integer, uuid, jsonb, pgEnum, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "@deployer/nest-schema/global/identity/auth";
import { environments } from "@deployer/nest-schema/global/project/environment";
import { encryptedText } from "@deployer/nest-schema/codecs/codec-registry";
import { traefikConfigBuilder } from "@deployer/nest-schema/codecs/codec-registry";
import {
    deploymentEnvironmentSchema,
    deploymentPhaseSchema,
    deploymentStatusSchema,
    logLevelSchema,
    rollbackStatusSchema,
    serviceProviderTypeSchema,
    serviceRunnerTypeSchema,
    serviceTypeSchema,
    sourceTypeSchema,
} from "@deployer/contracts-common";
import type { NetworkDnsRecordType } from "@deployer/contracts-entities";
import { zodEnumToPgEnumValues } from "@deployer/nest-schema/global/utils/zod-enum";
import { PROJECT_ROLES } from "@deployer/auth";
import { deployments } from "@deployer/nest-schema/global/runtime/deployment";
import { environmentVariables } from "@deployer/nest-schema/global/project/environment";
import { webhooks } from "@deployer/nest-schema/global/project/deployment";
// Preview environments - temporary deployments with subdomains
export const previewEnvironments = pgTable("preview_environments", {
    id: uuid("id").primaryKey().defaultRandom(),
    deploymentId: uuid("deployment_id")
        .notNull()
        .references(() => deployments.id, { onDelete: "cascade" }),
    subdomain: text("subdomain").notNull().unique(), // e.g., "myapp-pr-123"
    fullDomain: text("full_domain").notNull(), // e.g., "myapp-pr-123.preview.example.com"
    sslEnabled: boolean("ssl_enabled").default(true).notNull(),
    sslCertificatePath: text("ssl_certificate_path"), // Path to SSL cert if custom
    expiresAt: timestamp("expires_at"), // Auto-cleanup date
    isActive: boolean("is_active").default(true).notNull(),
    webhookTriggered: boolean("webhook_triggered").default(false).notNull(),
    environmentVariables: jsonb("environment_variables").$type<Record<string, string>>(),
    metadata: jsonb("metadata").$type<{
        pullRequestUrl?: string;
        branchName?: string;
        lastAccessedAt?: string;
        accessCount?: number;
    }>(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});



// GitHub App Installations - store GitHub app connection per user
export const githubInstallations = pgTable("github_installations", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").notNull().unique(), // GitHub installation ID
    accountLogin: text("account_login").notNull(), // GitHub username or org name
    accountType: text("account_type").notNull(), // GitHub account type ("User" or "Org")
    accountAvatarUrl: text("account_avatar_url"),
    repositoriesCount: integer("repositories_count").default(0),
    // GitHub App credentials (automatically encrypted/decrypted)
    appId: text("app_id"), // GitHub App ID (not encrypted - public identifier)
    privateKey: encryptedText("private_key"), // GitHub App private key (automatically encrypted)
    clientId: text("client_id"), // OAuth client ID (not encrypted - public identifier)
    clientSecret: encryptedText("client_secret"), // OAuth client secret (automatically encrypted)
    webhookSecret: encryptedText("webhook_secret"), // Webhook secret (automatically encrypted)
    permissions: jsonb("permissions").$type<{
        contents?: string; // read, write
        metadata?: string; // read
        pullRequests?: string; // read, write
        webhooks?: string; // read, write
        [key: string]: string | undefined;
    }>(),
    accessTokenUrl: text("access_token_url"), // URL to fetch installation access token
    htmlUrl: text("html_url"), // GitHub installation URL
    isActive: boolean("is_active").default(true).notNull(),
    lastSyncedAt: timestamp("last_synced_at"),
    metadata: jsonb("metadata").$type<{
        appSlug?: string;
        targetType?: string;
        suspendedAt?: string;
        [key: string]: any;
    }>(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});



// GitHub Repositories - track connected repositories
export const githubRepositories = pgTable("github_repositories", {
    id: uuid("id").primaryKey().defaultRandom(),
    installationId: uuid("installation_id")
        .notNull()
        .references(() => githubInstallations.id, { onDelete: "cascade" }),
    repositoryId: integer("repository_id").notNull().unique(), // GitHub repository ID
    name: text("name").notNull(),
    fullName: text("full_name").notNull(), // owner/repo
    private: boolean("private").notNull(),
    htmlUrl: text("html_url").notNull(),
    description: text("description"),
    defaultBranch: text("default_branch").notNull(),
    language: text("language"),
    forksCount: integer("forks_count").default(0),
    stargazersCount: integer("stargazers_count").default(0),
    isActive: boolean("is_active").default(true).notNull(),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});



export const previewEnvironmentsRelations = relations(previewEnvironments, ({ one }) => ({
    deployment: one(deployments, {
        fields: [previewEnvironments.deploymentId],
        references: [deployments.id],
    }),
}));



export const githubInstallationsRelations = relations(githubInstallations, ({ one, many }) => ({
    user: one(user, {
        fields: [githubInstallations.userId],
        references: [user.id],
    }),
    repositories: many(githubRepositories),
}));



export const githubRepositoriesRelations = relations(githubRepositories, ({ one }) => ({
    installation: one(githubInstallations, {
        fields: [githubRepositories.installationId],
        references: [githubInstallations.id],
    }),
}));
