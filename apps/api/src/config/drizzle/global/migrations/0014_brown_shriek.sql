CREATE TABLE "dns_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_type" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"credentials" text NOT NULL,
	"config" jsonb NOT NULL,
	"features" jsonb NOT NULL,
	"state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_network_config" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"public_address" text,
	"address_kind" text,
	"tunnel_enabled" boolean DEFAULT false NOT NULL,
	"tunnel_provider_id" uuid,
	"tunnel_id" text,
	"tunnel_hostname" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dns_providers_type_idx" ON "dns_providers" USING btree ("provider_type");