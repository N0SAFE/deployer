CREATE TABLE "cluster_migration_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cluster_schema_version" text NOT NULL,
	"required_app_version" text NOT NULL,
	"consensus_node_ids" jsonb NOT NULL,
	"record_version" integer DEFAULT 1 NOT NULL,
	"last_consensus_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_version" (
	"node_id" text PRIMARY KEY NOT NULL,
	"schema_version" text NOT NULL,
	"applied_migrations" jsonb NOT NULL,
	"app_version" text NOT NULL,
	"last_verification" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
