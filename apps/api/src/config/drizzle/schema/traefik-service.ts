import { boolean, integer, json, pgTable, text, timestamp, uuid, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { services } from './deployment';

// Service-based Traefik Configuration - main table
export const traefikServiceConfigs = pgTable('traefik_service_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id').references(() => services.id).notNull(),
  
  // Domain configuration
  domain: text('domain').notNull(),
  subdomain: text('subdomain'),
  fullDomain: text('full_domain').notNull(), // computed field: subdomain.domain or domain
  
  // SSL configuration
  sslEnabled: boolean('ssl_enabled').default(false),
  sslProvider: text('ssl_provider').$type<'letsencrypt' | 'selfsigned' | 'custom'>(),
  
  // Routing configuration
  pathPrefix: text('path_prefix'), // optional path prefix for the service
  port: integer('port').notNull(), // service port
  
  // Middleware configuration (stored as JSON)
  middleware: json('middleware'), // custom middleware config
  
  // Health check configuration
  healthCheck: json('health_check').$type<{
    enabled: boolean;
    path: string;
    interval?: number;
    timeout?: number;
  }>(),
  
  // Status and management
  isActive: boolean('is_active').default(true),
  configContent: text('config_content'), // generated YAML config content
  lastSyncedAt: timestamp('last_synced_at'),
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  serviceIdIndex: index('traefik_service_configs_service_id_idx').on(table.serviceId),
  domainIndex: index('traefik_service_configs_domain_idx').on(table.domain),
  fullDomainIndex: index('traefik_service_configs_full_domain_idx').on(table.fullDomain),
  uniqueServiceConfig: uniqueIndex('traefik_service_configs_service_id_unique').on(table.serviceId),
}));

// Domain routing rules (many-to-many between configs and domains)
export const traefikDomainRoutes = pgTable('traefik_domain_routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  configId: uuid('config_id').references(() => traefikServiceConfigs.id).notNull(),
  
  // Route configuration
  hostRule: text('host_rule').notNull(), // e.g., "Host(`api.example.com`)"
  pathRule: text('path_rule'), // e.g., "PathPrefix(`/api`)"
  method: text('method'), // HTTP method filter
  headers: json('headers'), // header-based routing
  
  // Route priority and conditions
  priority: integer('priority').default(1),
  entryPoint: text('entry_point').default('web'), // web, websecure, etc.
  
  // Middleware chain for this route
  middleware: json('middleware'), // route-specific middleware
  
  // Status
  isActive: boolean('is_active').default(true),
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  configIdIndex: index('traefik_domain_routes_config_id_idx').on(table.configId),
  hostRuleIndex: index('traefik_domain_routes_host_rule_idx').on(table.hostRule),
  priorityIndex: index('traefik_domain_routes_priority_idx').on(table.priority),
}));

// Service discovery and load balancer configurations
export const traefikServiceTargets = pgTable('traefik_service_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  configId: uuid('config_id').references(() => traefikServiceConfigs.id).notNull(),
  
  // Target configuration
  url: text('url').notNull(), // e.g., "http://service:3000"
  weight: integer('weight').default(1), // load balancing weight
  
  // Health check for this specific target
  healthCheck: json('health_check').$type<{
    enabled: boolean;
    path: string;
    interval?: number;
    timeout?: number;
    retries?: number;
  }>(),
  
  // Status
  isActive: boolean('is_active').default(true),
  lastHealthCheck: timestamp('last_health_check'),
  healthStatus: text('health_status').$type<'healthy' | 'unhealthy' | 'unknown'>().default('unknown'),
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  configIdIndex: index('traefik_service_targets_config_id_idx').on(table.configId),
  urlIndex: index('traefik_service_targets_url_idx').on(table.url),
  healthStatusIndex: index('traefik_service_targets_health_status_idx').on(table.healthStatus),
}));

// SSL certificate management
export const traefikSSLCertificates = pgTable('traefik_ssl_certificates', {
  id: uuid('id').primaryKey().defaultRandom(),
  configId: uuid('config_id').references(() => traefikServiceConfigs.id).notNull(),
  
  // Certificate details
  domain: text('domain').notNull(),
  subjectAltNames: json('subject_alt_names').$type<string[]>(), // additional domains
  
  // Certificate metadata
  issuer: text('issuer'), // e.g., "Let's Encrypt"
  serialNumber: text('serial_number'),
  fingerprint: text('fingerprint'),
  
  // Validity period
  notBefore: timestamp('not_before'),
  notAfter: timestamp('not_after'),
  
  // Certificate content (encrypted)
  certificateData: text('certificate_data'), // PEM format
  privateKeyData: text('private_key_data'), // encrypted private key
  
  // Auto-renewal configuration
  autoRenew: boolean('auto_renew').default(true),
  renewalThreshold: integer('renewal_threshold').default(30), // days before expiry
  lastRenewal: timestamp('last_renewal'),
  
  // Status
  isActive: boolean('is_active').default(true),
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  configIdIndex: index('traefik_ssl_certificates_config_id_idx').on(table.configId),
  domainIndex: index('traefik_ssl_certificates_domain_idx').on(table.domain),
  expiryIndex: index('traefik_ssl_certificates_expiry_idx').on(table.notAfter),
  uniqueDomainConfig: uniqueIndex('traefik_ssl_certificates_domain_config_unique').on(table.configId, table.domain),
}));

// Configuration file tracking (for file system management)
export const traefikConfigFiles = pgTable('traefik_config_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  configId: uuid('config_id').references(() => traefikServiceConfigs.id).notNull(),
  
  // File information
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(), // full path to the file
  relativePath: text('relative_path').notNull(), // relative to service config root
  
  // File metadata
  fileType: text('file_type').$type<'traefik' | 'ssl' | 'middleware' | 'config'>().default('config'),
  contentType: text('content_type'), // MIME type
  size: integer('size'), // file size in bytes
  checksum: text('checksum'), // file hash for change detection
  
  // File content (for small config files)
  content: text('content'), // actual file content
  
  // Sync status
  lastSynced: timestamp('last_synced'),
  syncStatus: text('sync_status').$type<'pending' | 'synced' | 'error'>().default('pending'),
  syncError: text('sync_error'),
  
  // Status
  isActive: boolean('is_active').default(true),
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  configIdIndex: index('traefik_config_files_config_id_idx').on(table.configId),
  filePathIndex: index('traefik_config_files_file_path_idx').on(table.filePath),
  fileTypeIndex: index('traefik_config_files_file_type_idx').on(table.fileType),
  syncStatusIndex: index('traefik_config_files_sync_status_idx').on(table.syncStatus),
  uniqueConfigFile: uniqueIndex('traefik_config_files_config_file_unique').on(table.configId, table.filePath),
}));

// Middleware definitions (reusable middleware components)
export const traefikMiddlewares = pgTable('traefik_middlewares', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Middleware identification
  name: text('name').notNull(),
  type: text('type').$type<'auth' | 'compression' | 'headers' | 'ratelimit' | 'redirect' | 'custom'>().notNull(),
  
  // Middleware configuration
  config: json('config').notNull(), // middleware-specific configuration
  description: text('description'),
  
  // Scope (global or per-service)
  isGlobal: boolean('is_global').default(false),
  serviceId: uuid('service_id').references(() => services.id), // null for global middleware
  
  // Status
  isActive: boolean('is_active').default(true),
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  nameIndex: index('traefik_middlewares_name_idx').on(table.name),
  typeIndex: index('traefik_middlewares_type_idx').on(table.type),
  serviceIdIndex: index('traefik_middlewares_service_id_idx').on(table.serviceId),
  uniqueServiceMiddleware: uniqueIndex('traefik_middlewares_service_name_unique').on(table.serviceId, table.name),
}));

// Relations
export const traefikServiceConfigsRelations = relations(traefikServiceConfigs, ({ one, many }) => ({
  service: one(services, {
    fields: [traefikServiceConfigs.serviceId],
    references: [services.id],
  }),
  domainRoutes: many(traefikDomainRoutes),
  serviceTargets: many(traefikServiceTargets),
  sslCertificates: many(traefikSSLCertificates),
  configFiles: many(traefikConfigFiles),
}));

export const traefikDomainRoutesRelations = relations(traefikDomainRoutes, ({ one }) => ({
  config: one(traefikServiceConfigs, {
    fields: [traefikDomainRoutes.configId],
    references: [traefikServiceConfigs.id],
  }),
}));

export const traefikServiceTargetsRelations = relations(traefikServiceTargets, ({ one }) => ({
  config: one(traefikServiceConfigs, {
    fields: [traefikServiceTargets.configId],
    references: [traefikServiceConfigs.id],
  }),
}));

export const traefikSSLCertificatesRelations = relations(traefikSSLCertificates, ({ one }) => ({
  config: one(traefikServiceConfigs, {
    fields: [traefikSSLCertificates.configId],
    references: [traefikServiceConfigs.id],
  }),
}));

export const traefikConfigFilesRelations = relations(traefikConfigFiles, ({ one }) => ({
  config: one(traefikServiceConfigs, {
    fields: [traefikConfigFiles.configId],
    references: [traefikServiceConfigs.id],
  }),
}));

export const traefikMiddlewaresRelations = relations(traefikMiddlewares, ({ one }) => ({
  service: one(services, {
    fields: [traefikMiddlewares.serviceId],
    references: [services.id],
  }),
}));