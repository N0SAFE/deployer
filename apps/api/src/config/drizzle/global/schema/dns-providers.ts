import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { encryptedText } from "@/config/drizzle/shared/custom-types/encrypted-text";

/**
 * Runtime state of a DNS provider app, refreshed live at runtime (never
 * authoritative — the DB copy is only the last-known cache used to paint the
 * UI before a live re-check lands).
 */
export interface DnsProviderRuntimeState {
    status: "ok" | "error" | "unknown";
    checkedAt: string | null;
    /** Cloudflare account id resolved from the token at runtime. */
    accountId: string | null;
    tokenValid: boolean | null;
    /** Live message when the last check failed (network / auth / rate-limit). */
    error: string | null;
}

/**
 * Feature flags a DNS provider app exposes. Other modules gate their UI and
 * behavior on these: a feature only "exists" when at least one provider app
 * has it enabled AND its runtime state is healthy.
 */
export interface DnsProviderFeatures {
    /** Manage DNS zones/records through this provider. */
    dnsManagement: boolean;
    /** Host Cloudflare Tunnels for node network configs. */
    tunnelManagement: boolean;
}

/**
 * First-class DNS provider storage — replaces the historical abuse of the
 * `github_apps` table. One row per provider "app" (e.g. a Cloudflare account
 * connection).
 */
export const dnsProviders = pgTable(
    "dns_providers",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        /** Lowercase provider type key used for dispatch: "cloudflare", ... */
        providerType: text("provider_type").notNull(),
        name: text("name").notNull(),
        isActive: boolean("is_active").notNull().default(true),
        /** Encrypted JSON credentials: { apiToken?, clientId?, clientSecret? }. */
        credentials: encryptedText("credentials").notNull(),
        /** Provider-specific non-secret config (e.g. account id). */
        config: jsonb("config")
            .$type<{ accountId?: string | null }>()
            .notNull()
            .$defaultFn(() => ({ accountId: null })),
        /** Feature flags enabled for this app. */
        features: jsonb("features")
            .$type<DnsProviderFeatures>()
            .notNull()
            .$defaultFn(() => ({ dnsManagement: true, tunnelManagement: false })),
        /** Last-known runtime state (cache only — re-checked live). */
        state: jsonb("state").$type<DnsProviderRuntimeState | null>().$defaultFn(() => null),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (table) => [
        index("dns_providers_type_idx").on(table.providerType),
    ],
);
