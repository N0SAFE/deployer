import {
  zodEnumToPgEnumValues2
} from "./migrations-trk55dxz.mjs";
import {
  projects2,
  services2
} from "./migrations-r9ccee18.mjs";

// packages/nest/schema/src/global/domain.ts
import {
  pgTable,
  uuid,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  varchar,
  unique,
  index
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  sslProviderSchema,
  verificationMethodSchema,
  verificationStatusSchema
} from "@deployer/contracts-common";
var verificationStatusEnum2 = pgEnum("verification_status", [
  ...zodEnumToPgEnumValues2(verificationStatusSchema)
]);
var verificationMethodEnum2 = pgEnum("verification_method", [
  ...zodEnumToPgEnumValues2(verificationMethodSchema)
]);
var sslProviderEnum2 = pgEnum("ssl_provider", [
  ...zodEnumToPgEnumValues2(sslProviderSchema)
]);
var projectDomains2 = pgTable("project_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  domain: varchar("domain", { length: 255 }).notNull(),
  verificationStatus: verificationStatusEnum2("verification_status").notNull().default("pending"),
  verificationMethod: verificationMethodEnum2("verification_method").notNull().default("txt_record"),
  verificationToken: varchar("verification_token", { length: 255 }).notNull(),
  dnsRecordChecked: boolean("dns_record_checked").notNull().default(false),
  lastVerificationAttempt: timestamp("last_verification_attempt"),
  verifiedAt: timestamp("verified_at"),
  allowedSubdomains: varchar("allowed_subdomains", { length: 100 }).array().notNull().default([]),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  metadata: jsonb("metadata").$type().default({})
}, (table) => [{
  uniqueProjectDomain: unique().on(table.projectId, table.domain),
  projectIdIdx: index("project_domains_project_id_idx").on(table.projectId),
  verificationStatusIdx: index("project_domains_verification_status_idx").on(table.verificationStatus)
}]);
var serviceDomainMappings2 = pgTable("service_domain_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull().references(() => services2.id, { onDelete: "cascade" }),
  projectDomainId: uuid("project_domain_id").notNull().references(() => projectDomains2.id, { onDelete: "cascade" }),
  subdomain: varchar("subdomain", { length: 63 }),
  basePath: varchar("base_path", { length: 255 }),
  isPrimary: boolean("is_primary").notNull().default(false),
  sslEnabled: boolean("ssl_enabled").notNull().default(true),
  sslProvider: sslProviderEnum2("ssl_provider").notNull().default("letsencrypt"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  metadata: jsonb("metadata").$type().default({})
}, (table) => [{
  uniqueUrl: unique().on(table.projectDomainId, table.subdomain, table.basePath),
  serviceIdIdx: index("service_domain_mappings_service_id_idx").on(table.serviceId),
  projectDomainIdIdx: index("service_domain_mappings_project_domain_id_idx").on(table.projectDomainId)
}]);
var projectDomainsRelations2 = relations(projectDomains2, ({ one, many }) => ({
  project: one(projects2, {
    fields: [projectDomains2.projectId],
    references: [projects2.id]
  }),
  serviceMappings: many(serviceDomainMappings2)
}));
var serviceDomainMappingsRelations2 = relations(serviceDomainMappings2, ({ one }) => ({
  service: one(services2, {
    fields: [serviceDomainMappings2.serviceId],
    references: [services2.id]
  }),
  projectDomain: one(projectDomains2, {
    fields: [serviceDomainMappings2.projectDomainId],
    references: [projectDomains2.id]
  })
}));

export { verificationStatusEnum2, verificationMethodEnum2, sslProviderEnum2, projectDomains2, serviceDomainMappings2, projectDomainsRelations2, serviceDomainMappingsRelations2 };
