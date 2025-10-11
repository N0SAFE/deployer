CREATE TABLE "provider_traefik_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_type" text NOT NULL,
	"template_name" text NOT NULL,
	"template_content" text NOT NULL,
	"description" text,
	"variables" jsonb,
	"is_default" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_traefik_templates_provider_type_unique" UNIQUE("provider_type")
);
--> statement-breakpoint
CREATE TABLE "service_traefik_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"template_content" text NOT NULL,
	"variables" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_traefik_templates" ADD CONSTRAINT "service_traefik_templates_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;