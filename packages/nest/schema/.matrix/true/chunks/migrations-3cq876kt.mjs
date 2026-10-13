import {
  projects2,
  services2,
  deployments2
} from "./migrations-r9ccee18.mjs";

// packages/nest/schema/src/global/traefik/index.ts
import { relations } from "drizzle-orm";
import { pgTable, text, boolean, timestamp, jsonb, integer, uuid, json, index, uniqueIndex } from "drizzle-orm/pg-core";
import z from "zod/v4";
var dnsStatusEnum = ["pending", "valid", "invalid", "error"];
var domainConfigs2 = pgTable("domain_configs", {
  id: text("id").primaryKey(),
  projectId: uuid("project_id").references(() => projects2.id, { onDelete: "cascade" }).notNull(),
  domain: text("domain").notNull(),
  subdomain: text("subdomain"),
  fullDomain: text("full_domain").notNull(),
  sslEnabled: boolean("ssl_enabled").default(false),
  sslProvider: text("ssl_provider"),
  certificatePath: text("certificate_path"),
  middleware: jsonb("middleware"),
  dnsStatus: text("dns_status", { enum: dnsStatusEnum }).default("pending"),
  dnsRecords: jsonb("dns_records"),
  dnsLastChecked: timestamp("dns_last_checked"),
  dnsErrorMessage: text("dns_error_message"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var routeConfigs2 = pgTable("route_configs", {
  id: text("id").primaryKey(),
  domainConfigId: text("domain_config_id").references(() => domainConfigs2.id, { onDelete: "cascade" }).notNull(),
  deploymentId: uuid("deployment_id").references(() => deployments2.id, { onDelete: "cascade" }),
  routeName: text("route_name").notNull(),
  serviceName: text("service_name").notNull(),
  containerName: text("container_name"),
  targetPort: integer("target_port").notNull(),
  pathPrefix: text("path_prefix"),
  priority: integer("priority").default(1),
  middleware: jsonb("middleware"),
  healthCheck: jsonb("health_check"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var traefikStaticConfigs2 = pgTable("traefik_static_configs", {
  id: text("id").primaryKey(),
  projectId: uuid("project_id").references(() => projects2.id, { onDelete: "cascade" }).notNull().unique(),
  globalConfig: jsonb("global_config"),
  apiConfig: jsonb("api_config"),
  entryPointsConfig: jsonb("entry_points_config"),
  providersConfig: jsonb("providers_config"),
  logConfig: jsonb("log_config"),
  accessLogConfig: jsonb("access_log_config"),
  metricsConfig: jsonb("metrics_config"),
  tracingConfig: jsonb("tracing_config"),
  tlsConfig: jsonb("tls_config"),
  certificateResolversConfig: jsonb("certificate_resolvers_config"),
  experimentalConfig: jsonb("experimental_config"),
  serversTransportConfig: jsonb("servers_transport_config"),
  hostResolverConfig: jsonb("host_resolver_config"),
  clusterConfig: jsonb("cluster_config"),
  fullConfig: jsonb("full_config"),
  configVersion: integer("config_version").default(1),
  syncStatus: text("sync_status").default("pending"),
  lastSyncedAt: timestamp("last_synced_at"),
  syncErrorMessage: text("sync_error_message"),
  isValid: boolean("is_valid").default(true),
  validationErrors: jsonb("validation_errors"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var traefikConfigs2 = pgTable("traefik_configs", {
  id: text("id").primaryKey(),
  configName: text("config_name").notNull(),
  configContent: text("config_content").notNull(),
  configType: text("config_type").notNull(),
  storageType: text("storage_type").notNull().default("project"),
  projectId: uuid("project_id").references(() => projects2.id, { onDelete: "cascade" }),
  requiresFile: boolean("requires_file").default(true),
  syncStatus: text("sync_status").default("pending"),
  lastSyncedAt: timestamp("last_synced_at"),
  syncErrorMessage: text("sync_error_message"),
  fileChecksum: text("file_checksum"),
  configVersion: integer("config_version").default(1),
  metadata: jsonb("metadata"),
  description: text("description"),
  tags: jsonb("tags"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var serviceConfigReferences2 = pgTable("service_config_references", {
  id: text("id").primaryKey(),
  serviceId: uuid("service_id").references(() => services2.id, { onDelete: "cascade" }).notNull(),
  traefikConfigId: text("traefik_config_id").references(() => traefikConfigs2.id, { onDelete: "cascade" }).notNull(),
  referenceType: text("reference_type").notNull(),
  priority: integer("priority").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var traefikMiddleware2 = pgTable("traefik_middleware", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects2.id, { onDelete: "cascade" }),
  middlewareName: text("middleware_name").notNull(),
  middlewareType: text("middleware_type").notNull(),
  configuration: jsonb("configuration").notNull(),
  isGlobal: boolean("is_global").default(false),
  priority: integer("priority").default(0),
  isActive: boolean("is_active").default(true),
  filePath: text("file_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var traefikPlugins2 = pgTable("traefik_plugins", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects2.id, { onDelete: "cascade" }),
  pluginName: text("plugin_name").notNull(),
  pluginVersion: text("plugin_version").notNull(),
  pluginSource: text("plugin_source").notNull(),
  configuration: jsonb("configuration"),
  isEnabled: boolean("is_enabled").default(true),
  filePath: text("file_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var traefikStaticFiles2 = pgTable("traefik_static_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects2.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileContent: text("file_content").notNull(),
  mimeType: text("mime_type").default("text/plain"),
  fileSize: integer("file_size"),
  relativePath: text("relative_path").notNull(),
  isPublic: boolean("is_public").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var traefikBackups2 = pgTable("traefik_backups", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects2.id, { onDelete: "cascade" }),
  backupName: text("backup_name").notNull(),
  backupType: text("backup_type").notNull(),
  originalPath: text("original_path").notNull(),
  backupContent: text("backup_content").notNull(),
  compressionType: text("compression_type"),
  backupSize: integer("backup_size"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at")
});
var configFiles2 = pgTable("config_files", {
  id: text("id").primaryKey(),
  traefikConfigId: text("traefik_config_id").references(() => traefikConfigs2.id, { onDelete: "cascade" }).notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"),
  checksum: text("checksum"),
  permissions: text("permissions").default("644"),
  owner: text("owner").default("traefik"),
  exists: boolean("exists").default(false),
  isWritable: boolean("is_writable").default(true),
  lastWriteAttempt: timestamp("last_write_attempt"),
  writeErrorMessage: text("write_error_message"),
  containerPath: text("container_path"),
  mountPoint: text("mount_point"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var traefikStaticConfigSchema2 = z.object({
  id: z.string(),
  projectId: z.uuid(),
  globalConfig: z.record(z.string(), z.unknown()).nullable(),
  apiConfig: z.record(z.string(), z.unknown()).nullable(),
  entryPointsConfig: z.record(z.string(), z.unknown()).nullable(),
  providersConfig: z.record(z.string(), z.unknown()).nullable(),
  logConfig: z.record(z.string(), z.unknown()).nullable(),
  accessLogConfig: z.record(z.string(), z.unknown()).nullable(),
  metricsConfig: z.record(z.string(), z.unknown()).nullable(),
  tracingConfig: z.record(z.string(), z.unknown()).nullable(),
  tlsConfig: z.record(z.string(), z.unknown()).nullable(),
  certificateResolversConfig: z.record(z.string(), z.unknown()).nullable(),
  experimentalConfig: z.record(z.string(), z.unknown()).nullable(),
  serversTransportConfig: z.record(z.string(), z.unknown()).nullable(),
  hostResolverConfig: z.record(z.string(), z.unknown()).nullable(),
  clusterConfig: z.record(z.string(), z.unknown()).nullable(),
  fullConfig: z.record(z.string(), z.unknown()).nullable(),
  configVersion: z.number().nullable(),
  syncStatus: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  syncErrorMessage: z.string().nullable(),
  isValid: z.boolean().nullable(),
  validationErrors: z.array(z.record(z.string(), z.unknown())).nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createTraefikStaticConfigSchema2 = traefikStaticConfigSchema2.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var domainConfigSchema2 = z.object({
  id: z.string(),
  projectId: z.uuid(),
  domain: z.string(),
  subdomain: z.string().nullable(),
  fullDomain: z.string(),
  sslEnabled: z.boolean().nullable(),
  sslProvider: z.string().nullable(),
  certificatePath: z.string().nullable(),
  middleware: z.record(z.string(), z.unknown()).nullable(),
  dnsStatus: z.enum(["pending", "valid", "invalid", "error"]).nullable(),
  dnsRecords: z.array(z.record(z.string(), z.unknown())).nullable(),
  dnsLastChecked: z.date().nullable(),
  dnsErrorMessage: z.string().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createDomainConfigSchema2 = domainConfigSchema2.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var routeConfigSchema2 = z.object({
  id: z.string(),
  domainConfigId: z.string(),
  deploymentId: z.uuid().nullable(),
  routeName: z.string(),
  serviceName: z.string(),
  containerName: z.string().nullable(),
  targetPort: z.number(),
  pathPrefix: z.string().nullable(),
  priority: z.number().nullable(),
  middleware: z.record(z.string(), z.unknown()).nullable(),
  healthCheck: z.record(z.string(), z.unknown()).nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createRouteConfigSchema2 = routeConfigSchema2.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var traefikConfigSchema2 = z.object({
  id: z.string(),
  configName: z.string(),
  configContent: z.string(),
  configType: z.string(),
  storageType: z.enum(["project", "standalone"]),
  projectId: z.uuid().nullable(),
  requiresFile: z.boolean().nullable(),
  syncStatus: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  syncErrorMessage: z.string().nullable(),
  fileChecksum: z.string().nullable(),
  configVersion: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  description: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var serviceConfigReferenceSchema2 = z.object({
  id: z.string(),
  serviceId: z.uuid(),
  traefikConfigId: z.string(),
  referenceType: z.string(),
  priority: z.number().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createTraefikConfigSchema2 = traefikConfigSchema2.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var createServiceConfigReferenceSchema2 = serviceConfigReferenceSchema2.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var configFileSchema2 = z.object({
  id: z.string(),
  traefikConfigId: z.string(),
  filePath: z.string(),
  fileSize: z.number().nullable(),
  checksum: z.string().nullable(),
  permissions: z.string().nullable(),
  owner: z.string().nullable(),
  exists: z.boolean().nullable(),
  isWritable: z.boolean().nullable(),
  lastWriteAttempt: z.date().nullable(),
  writeErrorMessage: z.string().nullable(),
  containerPath: z.string().nullable(),
  mountPoint: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createConfigFileSchema2 = configFileSchema2.omit({
  createdAt: true,
  updatedAt: true
});
var traefikSslCertificateSchema2 = z.object({
  id: z.string(),
  configId: z.uuid(),
  domain: z.string(),
  subjectAltNames: z.array(z.string()).nullable(),
  issuer: z.string().nullable(),
  serialNumber: z.string().nullable(),
  fingerprint: z.string().nullable(),
  notBefore: z.date().nullable(),
  notAfter: z.date().nullable(),
  certificateData: z.string().nullable(),
  privateKeyData: z.string().nullable(),
  autoRenew: z.boolean().nullable(),
  renewalThreshold: z.number().nullable(),
  lastRenewal: z.date().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var traefikMiddlewareSchema2 = z.object({
  id: z.string(),
  projectId: z.uuid().nullable(),
  middlewareName: z.string(),
  middlewareType: z.string(),
  configuration: z.record(z.string(), z.unknown()),
  isGlobal: z.boolean().nullable(),
  priority: z.number().nullable(),
  isActive: z.boolean().nullable(),
  filePath: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var traefikPluginSchema2 = z.object({
  id: z.string(),
  projectId: z.uuid().nullable(),
  pluginName: z.string(),
  pluginVersion: z.string(),
  pluginSource: z.string(),
  configuration: z.record(z.string(), z.unknown()).nullable(),
  isEnabled: z.boolean().nullable(),
  filePath: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var traefikStaticFileSchema2 = z.object({
  id: z.string(),
  projectId: z.uuid().nullable(),
  fileName: z.string(),
  fileContent: z.string(),
  mimeType: z.string().nullable(),
  fileSize: z.number().nullable(),
  relativePath: z.string(),
  isPublic: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var traefikBackupSchema2 = z.object({
  id: z.string(),
  projectId: z.uuid().nullable(),
  backupName: z.string(),
  backupType: z.string(),
  originalPath: z.string(),
  backupContent: z.string(),
  compressionType: z.string().nullable(),
  backupSize: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  expiresAt: z.date().nullable()
});
var createTraefikSslCertificateSchema2 = traefikSslCertificateSchema2.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
var createTraefikMiddlewareSchema2 = traefikMiddlewareSchema2.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
var createTraefikPluginSchema2 = traefikPluginSchema2.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
var createTraefikStaticFileSchema2 = traefikStaticFileSchema2.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
var createTraefikBackupSchema2 = traefikBackupSchema2.omit({ createdAt: true, expiresAt: true }).partial({ id: true });
var domainConfigsRelations2 = relations(domainConfigs2, ({ one, many }) => ({
  project: one(projects2, {
    fields: [domainConfigs2.projectId],
    references: [projects2.id]
  }),
  routes: many(routeConfigs2)
}));
var routeConfigsRelations2 = relations(routeConfigs2, ({ one }) => ({
  domainConfig: one(domainConfigs2, {
    fields: [routeConfigs2.domainConfigId],
    references: [domainConfigs2.id]
  }),
  deployment: one(deployments2, {
    fields: [routeConfigs2.deploymentId],
    references: [deployments2.id]
  })
}));
var traefikStaticConfigsRelations2 = relations(traefikStaticConfigs2, ({ one }) => ({
  project: one(projects2, {
    fields: [traefikStaticConfigs2.projectId],
    references: [projects2.id]
  })
}));
var traefikConfigsRelations2 = relations(traefikConfigs2, ({ one, many }) => ({
  project: one(projects2, {
    fields: [traefikConfigs2.projectId],
    references: [projects2.id]
  }),
  serviceReferences: many(serviceConfigReferences2),
  configFiles: many(configFiles2)
}));
var serviceConfigReferencesRelations2 = relations(serviceConfigReferences2, ({ one }) => ({
  service: one(services2, {
    fields: [serviceConfigReferences2.serviceId],
    references: [services2.id]
  }),
  traefikConfig: one(traefikConfigs2, {
    fields: [serviceConfigReferences2.traefikConfigId],
    references: [traefikConfigs2.id]
  })
}));
var configFilesRelations2 = relations(configFiles2, ({ one }) => ({
  traefikConfig: one(traefikConfigs2, {
    fields: [configFiles2.traefikConfigId],
    references: [traefikConfigs2.id]
  })
}));
var traefikMiddlewareRelations2 = relations(traefikMiddleware2, ({ one }) => ({
  project: one(projects2, {
    fields: [traefikMiddleware2.projectId],
    references: [projects2.id]
  })
}));
var traefikPluginsRelations2 = relations(traefikPlugins2, ({ one }) => ({
  project: one(projects2, {
    fields: [traefikPlugins2.projectId],
    references: [projects2.id]
  })
}));
var traefikStaticFilesRelations2 = relations(traefikStaticFiles2, ({ one }) => ({
  project: one(projects2, {
    fields: [traefikStaticFiles2.projectId],
    references: [projects2.id]
  })
}));
var traefikBackupsRelations2 = relations(traefikBackups2, ({ one }) => ({
  project: one(projects2, {
    fields: [traefikBackups2.projectId],
    references: [projects2.id]
  })
}));
var providerTraefikTemplates2 = pgTable("provider_traefik_templates", {
  id: text("id").primaryKey(),
  providerType: text("provider_type").notNull().unique(),
  templateName: text("template_name").notNull(),
  templateContent: text("template_content").notNull(),
  description: text("description"),
  variables: jsonb("variables"),
  isDefault: boolean("is_default").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var serviceTraefikTemplates2 = pgTable("service_traefik_templates", {
  id: text("id").primaryKey(),
  serviceId: uuid("service_id").references(() => services2.id, { onDelete: "cascade" }).notNull(),
  templateContent: text("template_content").notNull(),
  variables: jsonb("variables"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var providerTraefikTemplateSchema2 = z.object({
  id: z.string(),
  providerType: z.string(),
  templateName: z.string(),
  templateContent: z.string(),
  description: z.string().nullable(),
  variables: z.unknown().nullable(),
  isDefault: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createProviderTraefikTemplateSchema2 = providerTraefikTemplateSchema2.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var serviceTraefikTemplateSchema2 = z.object({
  id: z.string(),
  serviceId: z.uuid(),
  templateContent: z.string(),
  variables: z.unknown().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createServiceTraefikTemplateSchema2 = serviceTraefikTemplateSchema2.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var providerTraefikTemplatesRelations2 = relations(providerTraefikTemplates2, () => ({}));
var serviceTraefikTemplatesRelations2 = relations(serviceTraefikTemplates2, ({ one }) => ({
  service: one(services2, {
    fields: [serviceTraefikTemplates2.serviceId],
    references: [services2.id]
  })
}));
var traefikServiceConfigs2 = pgTable("traefik_service_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").references(() => services2.id, { onDelete: "cascade" }).notNull(),
  domain: text("domain").notNull(),
  subdomain: text("subdomain"),
  fullDomain: text("full_domain").notNull(),
  sslEnabled: boolean("ssl_enabled").default(false),
  sslProvider: text("ssl_provider").$type(),
  pathPrefix: text("path_prefix"),
  port: integer("port").notNull(),
  middleware: json("middleware"),
  healthCheck: json("health_check").$type(),
  isActive: boolean("is_active").default(true),
  configContent: text("config_content"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => [
  {
    serviceIdIndex: index("traefik_service_configs_service_id_idx").on(table.serviceId),
    domainIndex: index("traefik_service_configs_domain_idx").on(table.domain),
    fullDomainIndex: index("traefik_service_configs_full_domain_idx").on(table.fullDomain),
    uniqueServiceConfig: uniqueIndex("traefik_service_configs_service_id_unique").on(table.serviceId)
  }
]);
var traefikDomainRoutes2 = pgTable("traefik_domain_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => traefikServiceConfigs2.id, { onDelete: "cascade" }).notNull(),
  hostRule: text("host_rule").notNull(),
  pathRule: text("path_rule"),
  method: text("method"),
  headers: json("headers"),
  priority: integer("priority").default(1),
  entryPoint: text("entry_point").default("web"),
  middleware: json("middleware"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index("traefik_domain_routes_config_id_idx").on(table.configId),
    hostRuleIndex: index("traefik_domain_routes_host_rule_idx").on(table.hostRule),
    priorityIndex: index("traefik_domain_routes_priority_idx").on(table.priority)
  }
]);
var traefikServiceTargets2 = pgTable("traefik_service_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => traefikServiceConfigs2.id, { onDelete: "cascade" }).notNull(),
  url: text("url").notNull(),
  weight: integer("weight").default(1),
  healthCheck: json("health_check").$type(),
  isActive: boolean("is_active").default(true),
  lastHealthCheck: timestamp("last_health_check"),
  healthStatus: text("health_status").$type().default("unknown"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index("traefik_service_targets_config_id_idx").on(table.configId),
    urlIndex: index("traefik_service_targets_url_idx").on(table.url),
    healthStatusIndex: index("traefik_service_targets_health_status_idx").on(table.healthStatus)
  }
]);
var traefikSSLCertificates2 = pgTable("traefik_ssl_certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => traefikServiceConfigs2.id, { onDelete: "cascade" }).notNull(),
  domain: text("domain").notNull(),
  subjectAltNames: json("subject_alt_names").$type(),
  issuer: text("issuer"),
  serialNumber: text("serial_number"),
  fingerprint: text("fingerprint"),
  notBefore: timestamp("not_before"),
  notAfter: timestamp("not_after"),
  certificateData: text("certificate_data"),
  privateKeyData: text("private_key_data"),
  autoRenew: boolean("auto_renew").default(true),
  renewalThreshold: integer("renewal_threshold").default(30),
  lastRenewal: timestamp("last_renewal"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index("traefik_ssl_certificates_config_id_idx").on(table.configId),
    domainIndex: index("traefik_ssl_certificates_domain_idx").on(table.domain),
    expiryIndex: index("traefik_ssl_certificates_expiry_idx").on(table.notAfter),
    uniqueDomainConfig: uniqueIndex("traefik_ssl_certificates_domain_config_unique").on(table.configId, table.domain)
  }
]);
var traefikConfigFiles2 = pgTable("traefik_config_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => traefikServiceConfigs2.id, { onDelete: "cascade" }).notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  relativePath: text("relative_path").notNull(),
  fileType: text("file_type").$type().default("config"),
  contentType: text("content_type"),
  size: integer("size"),
  checksum: text("checksum"),
  content: text("content"),
  lastSynced: timestamp("last_synced"),
  syncStatus: text("sync_status").$type().default("pending"),
  syncError: text("sync_error"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index("traefik_config_files_config_id_idx").on(table.configId),
    filePathIndex: index("traefik_config_files_file_path_idx").on(table.filePath),
    fileTypeIndex: index("traefik_config_files_file_type_idx").on(table.fileType),
    syncStatusIndex: index("traefik_config_files_sync_status_idx").on(table.syncStatus),
    uniqueConfigFile: uniqueIndex("traefik_config_files_config_file_unique").on(table.configId, table.filePath)
  }
]);
var traefikMiddlewares2 = pgTable("traefik_middlewares", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").$type().notNull(),
  config: json("config").notNull(),
  description: text("description"),
  isGlobal: boolean("is_global").default(false),
  serviceId: uuid("service_id").references(() => services2.id),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => [
  {
    nameIndex: index("traefik_middlewares_name_idx").on(table.name),
    typeIndex: index("traefik_middlewares_type_idx").on(table.type),
    serviceIdIndex: index("traefik_middlewares_service_id_idx").on(table.serviceId),
    uniqueServiceMiddleware: uniqueIndex("traefik_middlewares_service_name_unique").on(table.serviceId, table.name)
  }
]);
var traefikServiceConfigsRelations2 = relations(traefikServiceConfigs2, ({ one, many }) => ({
  service: one(services2, {
    fields: [traefikServiceConfigs2.serviceId],
    references: [services2.id]
  }),
  domainRoutes: many(traefikDomainRoutes2),
  serviceTargets: many(traefikServiceTargets2),
  sslCertificates: many(traefikSSLCertificates2),
  configFiles: many(traefikConfigFiles2)
}));
var traefikDomainRoutesRelations2 = relations(traefikDomainRoutes2, ({ one }) => ({
  config: one(traefikServiceConfigs2, {
    fields: [traefikDomainRoutes2.configId],
    references: [traefikServiceConfigs2.id]
  })
}));
var traefikServiceTargetsRelations2 = relations(traefikServiceTargets2, ({ one }) => ({
  config: one(traefikServiceConfigs2, {
    fields: [traefikServiceTargets2.configId],
    references: [traefikServiceConfigs2.id]
  })
}));
var traefikSSLCertificatesRelations2 = relations(traefikSSLCertificates2, ({ one }) => ({
  config: one(traefikServiceConfigs2, {
    fields: [traefikSSLCertificates2.configId],
    references: [traefikServiceConfigs2.id]
  })
}));
var traefikConfigFilesRelations2 = relations(traefikConfigFiles2, ({ one }) => ({
  config: one(traefikServiceConfigs2, {
    fields: [traefikConfigFiles2.configId],
    references: [traefikServiceConfigs2.id]
  })
}));
var traefikMiddlewaresRelations2 = relations(traefikMiddlewares2, ({ one }) => ({
  service: one(services2, {
    fields: [traefikMiddlewares2.serviceId],
    references: [services2.id]
  })
}));

export { domainConfigs2, routeConfigs2, traefikStaticConfigs2, traefikConfigs2, serviceConfigReferences2, traefikMiddleware2, traefikPlugins2, traefikStaticFiles2, traefikBackups2, configFiles2, traefikStaticConfigSchema2, createTraefikStaticConfigSchema2, domainConfigSchema2, createDomainConfigSchema2, routeConfigSchema2, createRouteConfigSchema2, traefikConfigSchema2, serviceConfigReferenceSchema2, createTraefikConfigSchema2, createServiceConfigReferenceSchema2, configFileSchema2, createConfigFileSchema2, traefikSslCertificateSchema2, traefikMiddlewareSchema2, traefikPluginSchema2, traefikStaticFileSchema2, traefikBackupSchema2, createTraefikSslCertificateSchema2, createTraefikMiddlewareSchema2, createTraefikPluginSchema2, createTraefikStaticFileSchema2, createTraefikBackupSchema2, domainConfigsRelations2, routeConfigsRelations2, traefikStaticConfigsRelations2, traefikConfigsRelations2, serviceConfigReferencesRelations2, configFilesRelations2, traefikMiddlewareRelations2, traefikPluginsRelations2, traefikStaticFilesRelations2, traefikBackupsRelations2, providerTraefikTemplates2, serviceTraefikTemplates2, providerTraefikTemplateSchema2, createProviderTraefikTemplateSchema2, serviceTraefikTemplateSchema2, createServiceTraefikTemplateSchema2, providerTraefikTemplatesRelations2, serviceTraefikTemplatesRelations2, traefikServiceConfigs2, traefikDomainRoutes2, traefikServiceTargets2, traefikSSLCertificates2, traefikConfigFiles2, traefikMiddlewares2, traefikServiceConfigsRelations2, traefikDomainRoutesRelations2, traefikServiceTargetsRelations2, traefikSSLCertificatesRelations2, traefikConfigFilesRelations2, traefikMiddlewaresRelations2 };
