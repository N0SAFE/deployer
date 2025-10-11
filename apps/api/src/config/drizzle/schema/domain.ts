import { 
  pgTable, 
  uuid, 
  text, 
  timestamp, 
  boolean, 
  jsonb, 
  pgEnum,
  varchar,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organization } from "./auth";
import { projects, services } from "./deployment";

// ==========================================
// ENUMS
// ==========================================

export const verificationStatusEnum = pgEnum('verification_status', [
  'pending',
  'verified', 
  'failed'
]);

export const verificationMethodEnum = pgEnum('verification_method', [
  'txt_record',
  'cname_record'
]);

export const sslProviderEnum = pgEnum('ssl_provider', [
  'letsencrypt',
  'custom',
  'none'
]);

// ==========================================
// ORGANIZATION DOMAINS
// Registry of all domains owned by organization with verification status
// ==========================================

export const organizationDomains = pgTable('organization_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  domain: varchar('domain', { length: 255 }).notNull(),
  
  // Verification
  verificationStatus: verificationStatusEnum('verification_status')
    .notNull()
    .default('pending'),
  verificationMethod: verificationMethodEnum('verification_method')
    .notNull()
    .default('txt_record'),
  verificationToken: varchar('verification_token', { length: 255 }).notNull(),
  dnsRecordChecked: boolean('dns_record_checked').notNull().default(false),
  lastVerificationAttempt: timestamp('last_verification_attempt'),
  verifiedAt: timestamp('verified_at'),
  
  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  metadata: jsonb('metadata').$type<{
    registrar?: string;
    expiresAt?: Date;
    autoRenew?: boolean;
    [key: string]: any;
  }>().default({}),
}, (table) => ({
  uniqueDomainPerOrg: unique().on(table.organizationId, table.domain),
  verificationStatusIdx: index('org_domains_verification_status_idx').on(table.verificationStatus),
  organizationIdIdx: index('org_domains_organization_id_idx').on(table.organizationId),
}));

// ==========================================
// PROJECT DOMAINS
// Project's selected domains from organization with subdomain allocations
// ==========================================

export const projectDomains = pgTable('project_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  organizationDomainId: uuid('organization_domain_id')
    .notNull()
    .references(() => organizationDomains.id, { onDelete: 'cascade' }),
  
  // Subdomain management
  // e.g., ["api", "web", "admin", "*"]
  // "*" means any subdomain is allowed
  // Empty array means only root domain allowed
  allowedSubdomains: varchar('allowed_subdomains', { length: 100 })
    .array()
    .notNull()
    .default([]),
  
  isPrimary: boolean('is_primary').notNull().default(false),
  
  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  metadata: jsonb('metadata').$type<{
    notes?: string;
    [key: string]: any;
  }>().default({}),
}, (table) => ({
  uniqueProjectDomain: unique().on(table.projectId, table.organizationDomainId),
  projectIdIdx: index('project_domains_project_id_idx').on(table.projectId),
  orgDomainIdIdx: index('project_domains_org_domain_id_idx').on(table.organizationDomainId),
}));

// ==========================================
// SERVICE DOMAIN MAPPINGS
// Service's actual domain usage with subdomain and base path
// ==========================================

export const serviceDomainMappings = pgTable('service_domain_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  projectDomainId: uuid('project_domain_id')
    .notNull()
    .references(() => projectDomains.id, { onDelete: 'cascade' }),
  
  // URL configuration
  // subdomain: "api", "web", "admin", null for root domain
  subdomain: varchar('subdomain', { length: 63 }), // DNS subdomain max length
  // basePath: "/v1", "/api", "/app", null for root path
  basePath: varchar('base_path', { length: 255 }),
  
  // Priority and SSL
  isPrimary: boolean('is_primary').notNull().default(false),
  sslEnabled: boolean('ssl_enabled').notNull().default(true),
  sslProvider: sslProviderEnum('ssl_provider').notNull().default('letsencrypt'),
  
  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  metadata: jsonb('metadata').$type<{
    healthCheckPath?: string;
    [key: string]: any;
  }>().default({}),
}, (table) => ({
  // Prevent exact URL duplicates (same domain + subdomain + path)
  uniqueUrl: unique().on(table.projectDomainId, table.subdomain, table.basePath),
  serviceIdIdx: index('service_domain_mappings_service_id_idx').on(table.serviceId),
  projectDomainIdIdx: index('service_domain_mappings_project_domain_id_idx').on(table.projectDomainId),
}));

// ==========================================
// RELATIONS
// ==========================================

export const organizationDomainsRelations = relations(organizationDomains, ({ one, many }) => ({
  organization: one(organization, {
    fields: [organizationDomains.organizationId],
    references: [organization.id],
  }),
  projectDomains: many(projectDomains),
}));

export const projectDomainsRelations = relations(projectDomains, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectDomains.projectId],
    references: [projects.id],
  }),
  organizationDomain: one(organizationDomains, {
    fields: [projectDomains.organizationDomainId],
    references: [organizationDomains.id],
  }),
  serviceMappings: many(serviceDomainMappings),
}));

export const serviceDomainMappingsRelations = relations(serviceDomainMappings, ({ one }) => ({
  service: one(services, {
    fields: [serviceDomainMappings.serviceId],
    references: [services.id],
  }),
  projectDomain: one(projectDomains, {
    fields: [serviceDomainMappings.projectDomainId],
    references: [projectDomains.id],
  }),
}));
