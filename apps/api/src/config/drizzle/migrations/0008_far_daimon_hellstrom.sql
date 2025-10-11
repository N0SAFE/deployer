ALTER TABLE "github_installations" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "private_key" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "client_secret" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "webhook_secret" text;