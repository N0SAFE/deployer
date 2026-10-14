CREATE TABLE "app_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'external' NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_instances_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "app_instances_status_idx" ON "app_instances" USING btree ("status");