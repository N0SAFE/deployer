CREATE TABLE "image_project_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_identifier_normalized" text NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_scan_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"auto_scan_enabled" boolean DEFAULT false NOT NULL,
	"engines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"service_filters" jsonb DEFAULT 'null'::jsonb,
	"last_scan_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "project_scan_config_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "image_project_membership" ADD CONSTRAINT "image_project_membership_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_scan_config" ADD CONSTRAINT "project_scan_config_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ipm_image_project_uidx" ON "image_project_membership" USING btree ("image_identifier_normalized","project_id");