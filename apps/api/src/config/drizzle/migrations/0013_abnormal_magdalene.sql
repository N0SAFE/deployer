CREATE TYPE "public"."ssl_provider" AS ENUM('letsencrypt', 'custom', 'none');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('txt_record', 'cname_record');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
CREATE TABLE "organization_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"verification_method" "verification_method" DEFAULT 'txt_record' NOT NULL,
	"verification_token" varchar(255) NOT NULL,
	"dns_record_checked" boolean DEFAULT false NOT NULL,
	"last_verification_attempt" timestamp,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "organization_domains_organization_id_domain_unique" UNIQUE("organization_id","domain")
);
--> statement-breakpoint
CREATE TABLE "project_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_domain_id" uuid NOT NULL,
	"allowed_subdomains" varchar(100)[] DEFAULT '{}' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "project_domains_project_id_organization_domain_id_unique" UNIQUE("project_id","organization_domain_id")
);
--> statement-breakpoint
CREATE TABLE "service_domain_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"project_domain_id" uuid NOT NULL,
	"subdomain" varchar(63),
	"base_path" varchar(255),
	"is_primary" boolean DEFAULT false NOT NULL,
	"ssl_enabled" boolean DEFAULT true NOT NULL,
	"ssl_provider" "ssl_provider" DEFAULT 'letsencrypt' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "service_domain_mappings_project_domain_id_subdomain_base_path_unique" UNIQUE("project_domain_id","subdomain","base_path")
);
--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_domains" ADD CONSTRAINT "project_domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_domains" ADD CONSTRAINT "project_domains_organization_domain_id_organization_domains_id_fk" FOREIGN KEY ("organization_domain_id") REFERENCES "public"."organization_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_domain_mappings" ADD CONSTRAINT "service_domain_mappings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_domain_mappings" ADD CONSTRAINT "service_domain_mappings_project_domain_id_project_domains_id_fk" FOREIGN KEY ("project_domain_id") REFERENCES "public"."project_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_domains_verification_status_idx" ON "organization_domains" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "org_domains_organization_id_idx" ON "organization_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_domains_project_id_idx" ON "project_domains" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_domains_org_domain_id_idx" ON "project_domains" USING btree ("organization_domain_id");--> statement-breakpoint
CREATE INDEX "service_domain_mappings_service_id_idx" ON "service_domain_mappings" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_domain_mappings_project_domain_id_idx" ON "service_domain_mappings" USING btree ("project_domain_id");--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "builder_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "provider_id" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."service_builder";--> statement-breakpoint
DROP TYPE "public"."service_provider";