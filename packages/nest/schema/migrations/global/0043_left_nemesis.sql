CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"rank" integer NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"color" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "roles_scope_name_idx" ON "roles" USING btree ("scope","name");
--> statement-breakpoint
-- The project read-only role is `member` now (the catalog's name). Rewrite the enum in place: rows must be migrated
-- BEFORE the cast, or 'viewer' has no member of the new type.
ALTER TABLE "project_collaborators" ALTER COLUMN "role" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "project_collaborators" ALTER COLUMN "role" SET DATA TYPE text;
--> statement-breakpoint
DROP TYPE "public"."project_role";
--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('owner', 'maintainer', 'deployer', 'member');
--> statement-breakpoint
UPDATE "project_collaborators" SET "role" = 'member' WHERE "role" = 'viewer';
--> statement-breakpoint
ALTER TABLE "project_collaborators" ALTER COLUMN "role" SET DATA TYPE "public"."project_role" USING "role"::"public"."project_role";
--> statement-breakpoint
ALTER TABLE "project_collaborators" ALTER COLUMN "role" SET DEFAULT 'member'::"public"."project_role";
