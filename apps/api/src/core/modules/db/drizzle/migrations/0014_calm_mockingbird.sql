CREATE TABLE "system_status" (
	"id" varchar(50) PRIMARY KEY DEFAULT 'system' NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"seed_version" varchar(20) DEFAULT '1.0.0',
	"last_seeded_at" timestamp,
	"seed_metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
