import { pgTable, text, boolean, timestamp, jsonb, integer, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { deployments } from './deployment';

// Create enum for DNS status
const dnsStatusEnum = ['pending', 'valid', 'invalid', 'error'] as const;

// Traefik Instance table
export const traefikInstances = pgTable('traefik_instances', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  containerId: text('container_id'), // Docker container ID when running
  status: text('status').notNull().default('stopped'), // stopped, starting, running, stopping, error
  dashboardPort: integer('dashboard_port').default(8080),
  httpPort: integer('http_port').default(80),
  httpsPort: integer('https_port').default(443),
  acmeEmail: text('acme_email'),
  logLevel: text('log_level').default('INFO'),
  insecureApi: boolean('insecure_api').default(true),
  config: jsonb('config'), // Static configuration as JSON
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Domain Configuration table
export const domainConfigs = pgTable('domain_configs', {
  id: text('id').primaryKey(),
  traefikInstanceId: text('traefik_instance_id')
    .references(() => traefikInstances.id, { onDelete: 'cascade' })
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

// Traefik Configuration Files (dynamic configs)
export const traefikConfigs = pgTable('traefik_configs', {
  id: text('id').primaryKey(),
  traefikInstanceId: text('traefik_instance_id')
    .references(() => traefikInstances.id, { onDelete: 'cascade' })
    .notNull(),
  configName: text('config_name').notNull(), // e.g., "deployment-123.yml", "global.yml"
  configPath: text('config_path'), // File path in container (nullable for database-only configs)
  configContent: text('config_content').notNull(), // YAML content
  configType: text('config_type').notNull(), // static, dynamic, deployment
  // File sync fields
  requiresFile: boolean('requires_file').default(false), // Whether this config needs to be written to a file
  syncStatus: text('sync_status').default('pending'), // pending, synced, failed, outdated
  lastSyncedAt: timestamp('last_synced_at'),
  syncErrorMessage: text('sync_error_message'),
  fileChecksum: text('file_checksum'), // To detect file changes
  // Metadata
  configVersion: integer('config_version').default(1), // For versioning and rollback
  metadata: jsonb('metadata'), // Additional metadata like dependencies, priority, etc.
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
export const traefikInstanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  containerId: z.string().nullable(),
  status: z.string(),
  dashboardPort: z.number().nullable(),
  httpPort: z.number().nullable(), 
  httpsPort: z.number().nullable(),
  acmeEmail: z.string().nullable(),
  logLevel: z.string().nullable(),
  insecureApi: z.boolean().nullable(),
  config: z.any().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createTraefikInstanceSchema = traefikInstanceSchema.omit({ 
  createdAt: true, 
  updatedAt: true 
}).partial({ id: true });

export const domainConfigSchema = z.object({
  id: z.string(),
  traefikInstanceId: z.string(),
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
  traefikInstanceId: z.string(),
  configName: z.string(),
  configPath: z.string().nullable(),
  configContent: z.string(),
  configType: z.string(),
  // File sync fields
  requiresFile: z.boolean().nullable(),
  syncStatus: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  syncErrorMessage: z.string().nullable(),
  fileChecksum: z.string().nullable(),
  // Metadata
  configVersion: z.number().nullable(),
  metadata: z.any().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createTraefikConfigSchema = traefikConfigSchema.omit({
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

// TypeScript types
export type TraefikInstance = z.infer<typeof traefikInstanceSchema>;
export type CreateTraefikInstance = z.infer<typeof createTraefikInstanceSchema>;

export type DomainConfig = z.infer<typeof domainConfigSchema>;
export type CreateDomainConfig = z.infer<typeof createDomainConfigSchema>;

export type RouteConfig = z.infer<typeof routeConfigSchema>;
export type CreateRouteConfig = z.infer<typeof createRouteConfigSchema>;

export type TraefikConfig = z.infer<typeof traefikConfigSchema>;
export type CreateTraefikConfig = z.infer<typeof createTraefikConfigSchema>;

export type ConfigFile = z.infer<typeof configFileSchema>;
export type CreateConfigFile = z.infer<typeof createConfigFileSchema>;