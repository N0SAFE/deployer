CREATE TABLE "config_files" (
	"id" text PRIMARY KEY NOT NULL,
	"traefik_config_id" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"checksum" text,
	"permissions" text DEFAULT '644',
	"owner" text DEFAULT 'traefik',
	"exists" boolean DEFAULT false,
	"is_writable" boolean DEFAULT true,
	"last_write_attempt" timestamp,
	"write_error_message" text,
	"container_path" text,
	"mount_point" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "traefik_configs" ALTER COLUMN "config_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_configs" ADD COLUMN "dns_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "domain_configs" ADD COLUMN "dns_records" jsonb;--> statement-breakpoint
ALTER TABLE "domain_configs" ADD COLUMN "dns_last_checked" timestamp;--> statement-breakpoint
ALTER TABLE "domain_configs" ADD COLUMN "dns_error_message" text;--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD COLUMN "requires_file" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD COLUMN "sync_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD COLUMN "sync_error_message" text;--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD COLUMN "file_checksum" text;--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD COLUMN "config_version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "config_files" ADD CONSTRAINT "config_files_traefik_config_id_traefik_configs_id_fk" FOREIGN KEY ("traefik_config_id") REFERENCES "public"."traefik_configs"("id") ON DELETE cascade ON UPDATE no action;