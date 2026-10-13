// packages/nest/schema/src/global/dns-providers.ts
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { encryptedText } from "@deployer/nest-schema/codecs/codec-registry";
var dnsProviders2 = pgTable("dns_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerType: text("provider_type").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  credentials: encryptedText("credentials").notNull(),
  config: jsonb("config").$type().notNull().$defaultFn(() => ({ accountId: null })),
  features: jsonb("features").$type().notNull().$defaultFn(() => ({ dnsManagement: true, tunnelManagement: false })),
  state: jsonb("state").$type().$defaultFn(() => null),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date)
}, (table) => [
  index("dns_providers_type_idx").on(table.providerType)
]);

export { dnsProviders2 };
