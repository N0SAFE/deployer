CREATE TYPE "public"."rollback_status" AS ENUM('pending', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "deployment_rollbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_deployment_id" uuid NOT NULL,
	"to_deployment_id" uuid NOT NULL,
	"triggered_by" text,
	"status" "rollback_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment_rollbacks" ADD CONSTRAINT "deployment_rollbacks_from_deployment_id_deployments_id_fk" FOREIGN KEY ("from_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_rollbacks" ADD CONSTRAINT "deployment_rollbacks_to_deployment_id_deployments_id_fk" FOREIGN KEY ("to_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_rollbacks" ADD CONSTRAINT "deployment_rollbacks_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;