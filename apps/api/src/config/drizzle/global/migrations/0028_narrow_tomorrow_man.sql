DROP INDEX "github_webhook_events_delivery_id_idx";--> statement-breakpoint
ALTER TABLE "github_webhook_events" ALTER COLUMN "github_app_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "github_webhook_events_delivery_id_uniq_idx" ON "github_webhook_events" USING btree ("delivery_id");