CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"seed_completed" boolean DEFAULT false NOT NULL,
	"seed_completed_at" timestamp,
	"seed_version" text,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"maintenance_message" text,
	"feature_flags" json DEFAULT '{}'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
