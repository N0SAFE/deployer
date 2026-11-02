CREATE TABLE "auth_audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"target_id" text,
	"ip" text,
	"user_agent" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_audit_events_action_idx" ON "auth_audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "auth_audit_events_actor_idx" ON "auth_audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "auth_audit_events_target_idx" ON "auth_audit_events" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "auth_audit_events_created_at_idx" ON "auth_audit_events" USING btree ("created_at");