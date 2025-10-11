import { relations } from 'drizzle-orm';
import { pgTable, text, boolean, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { services } from './deployment';

// Provider Traefik Template table (default templates for each provider type)
export const providerTraefikTemplates = pgTable('provider_traefik_templates', {
    id: text('id').primaryKey(),
    providerType: text('provider_type').notNull().unique(), // 'github', 'static', 'docker', etc.
    templateName: text('template_name').notNull(),
    templateContent: text('template_content').notNull(), // YAML with variables like ~##domain##~, ~##subdomain##~, etc.
    description: text('description'),
    variables: jsonb('variables'), // Array of available variables with descriptions
    isDefault: boolean('is_default').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Service Traefik Template table (customizable per service)
export const serviceTraefikTemplates = pgTable('service_traefik_templates', {
    id: text('id').primaryKey(),
    serviceId: uuid('service_id')
        .references(() => services.id, { onDelete: 'cascade' })
        .notNull(),
    templateContent: text('template_content').notNull(), // YAML with variables
    variables: jsonb('variables'), // Custom variables specific to this service
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Zod schemas
export const providerTraefikTemplateSchema = z.object({
    id: z.string(),
    providerType: z.string(),
    templateName: z.string(),
    templateContent: z.string(),
    description: z.string().nullable(),
    variables: z.any().nullable(),
    isDefault: z.boolean().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const createProviderTraefikTemplateSchema = providerTraefikTemplateSchema.omit({
    createdAt: true,
    updatedAt: true,
}).partial({ id: true });

export const serviceTraefikTemplateSchema = z.object({
    id: z.string(),
    serviceId: z.string().uuid(),
    templateContent: z.string(),
    variables: z.any().nullable(),
    isActive: z.boolean().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const createServiceTraefikTemplateSchema = serviceTraefikTemplateSchema.omit({
    createdAt: true,
    updatedAt: true,
}).partial({ id: true });

// TypeScript types
export type ProviderTraefikTemplate = z.infer<typeof providerTraefikTemplateSchema>;
export type CreateProviderTraefikTemplate = z.infer<typeof createProviderTraefikTemplateSchema>;
export type ServiceTraefikTemplate = z.infer<typeof serviceTraefikTemplateSchema>;
export type CreateServiceTraefikTemplate = z.infer<typeof createServiceTraefikTemplateSchema>;

// Relations
export const providerTraefikTemplatesRelations = relations(providerTraefikTemplates, ({ many }) => ({
    // Can add relations if needed
}));

export const serviceTraefikTemplatesRelations = relations(serviceTraefikTemplates, ({ one }) => ({
    service: one(services, {
        fields: [serviceTraefikTemplates.serviceId],
        references: [services.id],
    }),
}));
