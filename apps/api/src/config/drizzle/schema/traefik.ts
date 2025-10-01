import { relations } from 'drizzle-orm';
import { pgTable, text, boolean, timestamp, jsonb, integer, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { deployments, projects, services } from './deployment';
import { traefikServiceConfigs } from './traefik-service';

// Create enum for DNS status
const dnsStatusEnum = ['pending', 'valid', 'invalid', 'error'] as const;

// Domain Configuration table (now references projects directly)
export const domainConfigs = pgTable('domain_configs', {
    id: text('id').primaryKey(),
    projectId: uuid('project_id')
        .references(() => projects.id, { onDelete: 'cascade' })
        .notNull(),
    domain: text('domain').notNull(), // e.g., "example.com", "app.localhost"
    subdomain: text('subdomain'), // e.g., "api", "app", null for root
    fullDomain: text('full_domain').notNull(), // e.g., "api.example.com", "example.com"
    sslEnabled: boolean('ssl_enabled').default(false),
    sslProvider: text('ssl_provider'), // letsencrypt, selfsigned, custom
    certificatePath: text('certificate_path'),
    middleware: jsonb('middleware'), // CORS, auth, rate limiting, etc.
    // DNS validation fields
    dnsStatus: text('dns_status', { enum: dnsStatusEnum }).default('pending'), // pending, valid, invalid, error
    dnsRecords: jsonb('dns_records'), // Store resolved DNS records
    dnsLastChecked: timestamp('dns_last_checked'),
    dnsErrorMessage: text('dns_error_message'),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
// Route Configuration table  
export const routeConfigs = pgTable('route_configs', {
    id: text('id').primaryKey(),
    domainConfigId: text('domain_config_id')
        .references(() => domainConfigs.id, { onDelete: 'cascade' })
        .notNull(),
    deploymentId: uuid('deployment_id')
        .references(() => deployments.id, { onDelete: 'cascade' }),
    routeName: text('route_name').notNull(), // traefik router name
    serviceName: text('service_name').notNull(), // traefik service name
    containerName: text('container_name'), // target container
    targetPort: integer('target_port').notNull(),
    pathPrefix: text('path_prefix'), // e.g., "/api", "/", "/admin"
    priority: integer('priority').default(1),
    middleware: jsonb('middleware'), // Route-specific middleware
    healthCheck: jsonb('health_check'), // Health check config
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
// Traefik Project Static Configuration (main traefik.yml config)
export const traefikStaticConfigs = pgTable('traefik_static_configs', {
    id: text('id').primaryKey(),
    projectId: uuid('project_id')
        .references(() => projects.id, { onDelete: 'cascade' })
        .notNull()
        .unique(), // One static config per project
    // Core configuration sections
    globalConfig: jsonb('global_config'), // Global settings
    apiConfig: jsonb('api_config'), // API and dashboard settings
    entryPointsConfig: jsonb('entry_points_config'), // Entry points configuration
    providersConfig: jsonb('providers_config'), // Providers (docker, file, etc.)
    // Observability
    logConfig: jsonb('log_config'), // Logging configuration
    accessLogConfig: jsonb('access_log_config'), // Access logs
    metricsConfig: jsonb('metrics_config'), // Metrics (prometheus, datadog, etc.)
    tracingConfig: jsonb('tracing_config'), // Tracing (jaeger, zipkin, etc.)
    // Security and TLS
    tlsConfig: jsonb('tls_config'), // TLS configuration
    certificateResolversConfig: jsonb('certificate_resolvers_config'), // ACME and cert resolvers
    // Advanced features
    experimentalConfig: jsonb('experimental_config'), // Experimental features and plugins
    serversTransportConfig: jsonb('servers_transport_config'), // Server transport config
    hostResolverConfig: jsonb('host_resolver_config'), // Host resolver config
    clusterConfig: jsonb('cluster_config'), // Cluster configuration
    // Full configuration cache (generated from individual sections)
    fullConfig: jsonb('full_config'), // Complete merged configuration
    configVersion: integer('config_version').default(1), // Version for tracking changes
    // File sync status
    syncStatus: text('sync_status').default('pending'), // pending, synced, failed
    lastSyncedAt: timestamp('last_synced_at'),
    syncErrorMessage: text('sync_error_message'),
    // Validation
    isValid: boolean('is_valid').default(true),
    validationErrors: jsonb('validation_errors'), // Configuration validation errors
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
// Traefik Configuration Files (independent configs that can be referenced by services or standalone)
export const traefikConfigs = pgTable('traefik_configs', {
    id: text('id').primaryKey(),
    configName: text('config_name').notNull(), // e.g., "deployment-123.yml", "global.yml", "middleware.yml"
    configContent: text('config_content').notNull(), // YAML content
    configType: text('config_type').notNull(), // middleware, router, service, tls, etc.
    
    // Storage location (determines file path)
    storageType: text('storage_type').notNull().default('project'), // 'project' or 'standalone'
    projectId: uuid('project_id')
        .references(() => projects.id, { onDelete: 'cascade' }), // nullable for standalone configs
    
    // File sync fields
    requiresFile: boolean('requires_file').default(true), // Whether this config needs to be written to a file
    syncStatus: text('sync_status').default('pending'), // pending, synced, failed, outdated
    lastSyncedAt: timestamp('last_synced_at'),
    syncErrorMessage: text('sync_error_message'),
    fileChecksum: text('file_checksum'), // To detect file changes
    
    // Metadata
    configVersion: integer('config_version').default(1), // For versioning and rollback
    metadata: jsonb('metadata'), // Additional metadata like dependencies, priority, etc.
    description: text('description'), // Human-readable description
    tags: jsonb('tags'), // Array of tags for categorization
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Service Config References (many-to-many: services can reference multiple configs, configs can be referenced by multiple services)
export const serviceConfigReferences = pgTable('service_config_references', {
    id: text('id').primaryKey(),
    serviceId: uuid('service_id')
        .references(() => services.id, { onDelete: 'cascade' })
        .notNull(),
    traefikConfigId: text('traefik_config_id')
        .references(() => traefikConfigs.id, { onDelete: 'cascade' })
        .notNull(),
    
    // Reference metadata
    referenceType: text('reference_type').notNull(), // 'primary', 'middleware', 'tls', etc.
    priority: integer('priority').default(0), // Order of application if multiple configs of same type
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
// SSL Certificates table
export const traefikSslCertificates = pgTable('traefik_ssl_certificates', {
    id: uuid('id').primaryKey().defaultRandom(),
    configId: uuid('config_id')
        .references(() => traefikServiceConfigs.id, { onDelete: 'no action' })
        .notNull(),
    domain: text('domain').notNull(),
    subjectAltNames: jsonb('subject_alt_names'),
    issuer: text('issuer'),
    serialNumber: text('serial_number'),
    fingerprint: text('fingerprint'),
    notBefore: timestamp('not_before'),
    notAfter: timestamp('not_after'),
    certificateData: text('certificate_data'),
    privateKeyData: text('private_key_data'),
    autoRenew: boolean('auto_renew').default(true),
    renewalThreshold: integer('renewal_threshold').default(30),
    lastRenewal: timestamp('last_renewal'),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// Middleware table
export const traefikMiddleware = pgTable('traefik_middleware', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
        .references(() => projects.id, { onDelete: 'cascade' }),
    middlewareName: text('middleware_name').notNull(),
    middlewareType: text('middleware_type').notNull(), // 'cors', 'auth', 'ratelimit', 'compress', etc.
    configuration: jsonb('configuration').notNull(), // Middleware configuration
    isGlobal: boolean('is_global').default(false), // Global vs project-specific
    priority: integer('priority').default(0),
    isActive: boolean('is_active').default(true),
    filePath: text('file_path'), // Path in middleware directory
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Plugins table
export const traefikPlugins = pgTable('traefik_plugins', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
        .references(() => projects.id, { onDelete: 'cascade' }),
    pluginName: text('plugin_name').notNull(),
    pluginVersion: text('plugin_version').notNull(),
    pluginSource: text('plugin_source').notNull(), // URL or registry reference
    configuration: jsonb('configuration'), // Plugin configuration
    isEnabled: boolean('is_enabled').default(true),
    filePath: text('file_path'), // Path in plugins directory
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Static Files table
export const traefikStaticFiles = pgTable('traefik_static_files', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
        .references(() => projects.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    fileContent: text('file_content').notNull(),
    mimeType: text('mime_type').default('text/plain'),
    fileSize: integer('file_size'),
    relativePath: text('relative_path').notNull(), // Path relative to static directory
    isPublic: boolean('is_public').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Backups table
export const traefikBackups = pgTable('traefik_backups', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
        .references(() => projects.id, { onDelete: 'cascade' }),
    backupName: text('backup_name').notNull(),
    backupType: text('backup_type').notNull(), // 'config', 'ssl', 'middleware', 'full'
    originalPath: text('original_path').notNull(),
    backupContent: text('backup_content').notNull(),
    compressionType: text('compression_type'), // 'gzip', 'none'
    backupSize: integer('backup_size'),
    metadata: jsonb('metadata'), // Additional backup metadata
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'), // Auto-cleanup date
});

// Configuration File Tracking (tracks actual files on filesystem)
export const configFiles = pgTable('config_files', {
    id: text('id').primaryKey(),
    traefikConfigId: text('traefik_config_id')
        .references(() => traefikConfigs.id, { onDelete: 'cascade' })
        .notNull(),
    filePath: text('file_path').notNull(), // Absolute path to the file
    fileSize: integer('file_size'), // File size in bytes
    checksum: text('checksum'), // File content checksum
    permissions: text('permissions').default('644'), // File permissions
    owner: text('owner').default('traefik'), // File owner
    // File status
    exists: boolean('exists').default(false), // Whether file exists on filesystem
    isWritable: boolean('is_writable').default(true), // Whether file can be written
    lastWriteAttempt: timestamp('last_write_attempt'),
    writeErrorMessage: text('write_error_message'),
    // Metadata
    containerPath: text('container_path'), // Path inside the container if different
    mountPoint: text('mount_point'), // Docker mount point info
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
// Zod schemas for validation (manual creation since drizzle-zod is not available)
export const traefikStaticConfigSchema = z.object({
    id: z.string(),
    projectId: z.string().uuid(),
    // Core configuration sections
    globalConfig: z.any().nullable(),
    apiConfig: z.any().nullable(),
    entryPointsConfig: z.any().nullable(),
    providersConfig: z.any().nullable(),
    // Observability
    logConfig: z.any().nullable(),
    accessLogConfig: z.any().nullable(),
    metricsConfig: z.any().nullable(),
    tracingConfig: z.any().nullable(),
    // Security and TLS
    tlsConfig: z.any().nullable(),
    certificateResolversConfig: z.any().nullable(),
    // Advanced features
    experimentalConfig: z.any().nullable(),
    serversTransportConfig: z.any().nullable(),
    hostResolverConfig: z.any().nullable(),
    clusterConfig: z.any().nullable(),
    // Full configuration cache
    fullConfig: z.any().nullable(),
    configVersion: z.number().nullable(),
    // File sync status
    syncStatus: z.string().nullable(),
    lastSyncedAt: z.date().nullable(),
    syncErrorMessage: z.string().nullable(),
    // Validation
    isValid: z.boolean().nullable(),
    validationErrors: z.any().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const createTraefikStaticConfigSchema = traefikStaticConfigSchema.omit({
    createdAt: true,
    updatedAt: true
}).partial({ id: true });
export const domainConfigSchema = z.object({
    id: z.string(),
    projectId: z.string().uuid(),
    domain: z.string(),
    subdomain: z.string().nullable(),
    fullDomain: z.string(),
    sslEnabled: z.boolean().nullable(),
    sslProvider: z.string().nullable(),
    certificatePath: z.string().nullable(),
    middleware: z.any().nullable(),
    // DNS validation fields
    dnsStatus: z.enum(['pending', 'valid', 'invalid', 'error']).nullable(),
    dnsRecords: z.any().nullable(),
    dnsLastChecked: z.date().nullable(),
    dnsErrorMessage: z.string().nullable(),
    isActive: z.boolean().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const createDomainConfigSchema = domainConfigSchema.omit({
    createdAt: true,
    updatedAt: true
}).partial({ id: true });
export const routeConfigSchema = z.object({
    id: z.string(),
    domainConfigId: z.string(),
    deploymentId: z.string().uuid().nullable(),
    routeName: z.string(),
    serviceName: z.string(),
    containerName: z.string().nullable(),
    targetPort: z.number(),
    pathPrefix: z.string().nullable(),
    priority: z.number().nullable(),
    middleware: z.any().nullable(),
    healthCheck: z.any().nullable(),
    isActive: z.boolean().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const createRouteConfigSchema = routeConfigSchema.omit({
    createdAt: true,
    updatedAt: true
}).partial({ id: true });
export const traefikConfigSchema = z.object({
    id: z.string(),
    configName: z.string(),
    configContent: z.string(),
    configType: z.string(),
    
    // Storage location
    storageType: z.enum(['project', 'standalone']),
    projectId: z.string().uuid().nullable(),
    
    // File sync fields
    requiresFile: z.boolean().nullable(),
    syncStatus: z.string().nullable(),
    lastSyncedAt: z.date().nullable(),
    syncErrorMessage: z.string().nullable(),
    fileChecksum: z.string().nullable(),
    
    // Metadata
    configVersion: z.number().nullable(),
    metadata: z.any().nullable(),
    description: z.string().nullable(),
    tags: z.any().nullable(),
    isActive: z.boolean().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const serviceConfigReferenceSchema = z.object({
    id: z.string(),
    serviceId: z.string().uuid(),
    traefikConfigId: z.string(),
    
    // Reference metadata
    referenceType: z.string(),
    priority: z.number().nullable(),
    isActive: z.boolean().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const createTraefikConfigSchema = traefikConfigSchema.omit({
    createdAt: true,
    updatedAt: true
}).partial({ id: true });

export const createServiceConfigReferenceSchema = serviceConfigReferenceSchema.omit({
    createdAt: true,
    updatedAt: true
}).partial({ id: true });
export const configFileSchema = z.object({
    id: z.string(),
    traefikConfigId: z.string(),
    filePath: z.string(),
    fileSize: z.number().nullable(),
    checksum: z.string().nullable(),
    permissions: z.string().nullable(),
    owner: z.string().nullable(),
    // File status
    exists: z.boolean().nullable(),
    isWritable: z.boolean().nullable(),
    lastWriteAttempt: z.date().nullable(),
    writeErrorMessage: z.string().nullable(),
    // Metadata
    containerPath: z.string().nullable(),
    mountPoint: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const createConfigFileSchema = configFileSchema.omit({
    createdAt: true,
    updatedAt: true
});

// Zod schemas for new tables
export const traefikSslCertificateSchema = z.object({
    id: z.string(),
    configId: z.string().uuid(),
    domain: z.string(),
    subjectAltNames: z.any().nullable(),
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
    updatedAt: z.date(),
});

export const traefikMiddlewareSchema = z.object({
    id: z.string(),
    projectId: z.string().uuid().nullable(),
    middlewareName: z.string(),
    middlewareType: z.string(),
    configuration: z.any(),
    isGlobal: z.boolean().nullable(),
    priority: z.number().nullable(),
    isActive: z.boolean().nullable(),
    filePath: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const traefikPluginSchema = z.object({
    id: z.string(),
    projectId: z.string().uuid().nullable(),
    pluginName: z.string(),
    pluginVersion: z.string(),
    pluginSource: z.string(),
    configuration: z.any().nullable(),
    isEnabled: z.boolean().nullable(),
    filePath: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const traefikStaticFileSchema = z.object({
    id: z.string(),
    projectId: z.string().uuid().nullable(),
    fileName: z.string(),
    fileContent: z.string(),
    mimeType: z.string().nullable(),
    fileSize: z.number().nullable(),
    relativePath: z.string(),
    isPublic: z.boolean().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const traefikBackupSchema = z.object({
    id: z.string(),
    projectId: z.string().uuid().nullable(),
    backupName: z.string(),
    backupType: z.string(),
    originalPath: z.string(),
    backupContent: z.string(),
    compressionType: z.string().nullable(),
    backupSize: z.number().nullable(),
    metadata: z.any().nullable(),
    createdAt: z.date(),
    expiresAt: z.date().nullable(),
});

// Create schemas
export const createTraefikSslCertificateSchema = traefikSslCertificateSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
export const createTraefikMiddlewareSchema = traefikMiddlewareSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
export const createTraefikPluginSchema = traefikPluginSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
export const createTraefikStaticFileSchema = traefikStaticFileSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
export const createTraefikBackupSchema = traefikBackupSchema.omit({ createdAt: true, expiresAt: true }).partial({ id: true });
// TypeScript types
export type TraefikStaticConfig = z.infer<typeof traefikStaticConfigSchema>;
export type CreateTraefikStaticConfig = z.infer<typeof createTraefikStaticConfigSchema>;
export type DomainConfig = z.infer<typeof domainConfigSchema>;
export type CreateDomainConfig = z.infer<typeof createDomainConfigSchema>;
export type RouteConfig = z.infer<typeof routeConfigSchema>;
export type CreateRouteConfig = z.infer<typeof createRouteConfigSchema>;
export type TraefikConfig = z.infer<typeof traefikConfigSchema>;
export type CreateTraefikConfig = z.infer<typeof createTraefikConfigSchema>;
export type ServiceConfigReference = z.infer<typeof serviceConfigReferenceSchema>;
export type CreateServiceConfigReference = z.infer<typeof createServiceConfigReferenceSchema>;
export type ConfigFile = z.infer<typeof configFileSchema>;
export type CreateConfigFile = z.infer<typeof createConfigFileSchema>;

// New types
export type TraefikSslCertificate = z.infer<typeof traefikSslCertificateSchema>;
export type CreateTraefikSslCertificate = z.infer<typeof createTraefikSslCertificateSchema>;
export type TraefikMiddleware = z.infer<typeof traefikMiddlewareSchema>;
export type CreateTraefikMiddleware = z.infer<typeof createTraefikMiddlewareSchema>;
export type TraefikPlugin = z.infer<typeof traefikPluginSchema>;
export type CreateTraefikPlugin = z.infer<typeof createTraefikPluginSchema>;
export type TraefikStaticFile = z.infer<typeof traefikStaticFileSchema>;
export type CreateTraefikStaticFile = z.infer<typeof createTraefikStaticFileSchema>;
export type TraefikBackup = z.infer<typeof traefikBackupSchema>;
export type CreateTraefikBackup = z.infer<typeof createTraefikBackupSchema>;

// Relations
export const traefikConfigsRelations = relations(traefikConfigs, ({ one, many }) => ({
    project: one(projects, {
        fields: [traefikConfigs.projectId],
        references: [projects.id],
    }),
    serviceReferences: many(serviceConfigReferences),
    configFiles: many(configFiles),
}));

export const serviceConfigReferencesRelations = relations(serviceConfigReferences, ({ one }) => ({
    service: one(services, {
        fields: [serviceConfigReferences.serviceId],
        references: [services.id],
    }),
    traefikConfig: one(traefikConfigs, {
        fields: [serviceConfigReferences.traefikConfigId],
        references: [traefikConfigs.id],
    }),
}));

export const configFilesRelations = relations(configFiles, ({ one }) => ({
    traefikConfig: one(traefikConfigs, {
        fields: [configFiles.traefikConfigId],
        references: [traefikConfigs.id],
    }),
}));
