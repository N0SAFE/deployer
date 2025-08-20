CREATE TABLE "domain_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"traefik_instance_id" text NOT NULL,
	"domain" text NOT NULL,
	"subdomain" text,
	"full_domain" text NOT NULL,
	"ssl_enabled" boolean DEFAULT false,
	"ssl_provider" text,
	"certificate_path" text,
	"middleware" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_config_id" text NOT NULL,
	"deployment_id" uuid,
	"route_name" text NOT NULL,
	"service_name" text NOT NULL,
	"container_name" text,
	"target_port" integer NOT NULL,
	"path_prefix" text,
	"priority" integer DEFAULT 1,
	"middleware" jsonb,
	"health_check" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traefik_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"traefik_instance_id" text NOT NULL,
	"config_name" text NOT NULL,
	"config_path" text NOT NULL,
	"config_content" text NOT NULL,
	"config_type" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traefik_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"container_id" text,
	"status" text DEFAULT 'stopped' NOT NULL,
	"dashboard_port" integer DEFAULT 8080,
	"http_port" integer DEFAULT 80,
	"https_port" integer DEFAULT 443,
	"acme_email" text,
	"log_level" text DEFAULT 'INFO',
	"insecure_api" boolean DEFAULT true,
	"config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_configs" ADD CONSTRAINT "domain_configs_traefik_instance_id_traefik_instances_id_fk" FOREIGN KEY ("traefik_instance_id") REFERENCES "public"."traefik_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_configs" ADD CONSTRAINT "route_configs_domain_config_id_domain_configs_id_fk" FOREIGN KEY ("domain_config_id") REFERENCES "public"."domain_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_configs" ADD CONSTRAINT "route_configs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD CONSTRAINT "traefik_configs_traefik_instance_id_traefik_instances_id_fk" FOREIGN KEY ("traefik_instance_id") REFERENCES "public"."traefik_instances"("id") ON DELETE cascade ON UPDATE no action;