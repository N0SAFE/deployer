CREATE TABLE "step_up_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"method" text NOT NULL,
	"reason" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "step_up_events_session_idx" ON "step_up_events" USING btree ("session_id","verified_at");--> statement-breakpoint
CREATE INDEX "step_up_events_user_idx" ON "step_up_events" USING btree ("user_id","verified_at");