CREATE TABLE "docker_image_security_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" text NOT NULL,
	"image_identifier_normalized" text NOT NULL,
	"vulnerabilities" jsonb NOT NULL,
	"scan_summary" jsonb NOT NULL,
	"last_updated" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "docker_image_security_scans_identifier_uidx" ON "docker_image_security_scans" USING btree ("image_identifier_normalized");--> statement-breakpoint
CREATE INDEX "docker_image_security_scans_image_idx" ON "docker_image_security_scans" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "docker_image_security_scans_last_updated_idx" ON "docker_image_security_scans" USING btree ("last_updated");