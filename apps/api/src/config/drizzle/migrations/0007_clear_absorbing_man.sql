CREATE TYPE "public"."deployment_rule_trigger" AS ENUM('push', 'pull_request', 'tag', 'release', 'manual');--> statement-breakpoint
CREATE TABLE "deployment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" "deployment_rule_trigger" NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"branch_pattern" text,
	"exclude_branch_pattern" text,
	"tag_pattern" text,
	"pr_labels" jsonb,
	"pr_target_branches" jsonb,
	"require_approval" boolean DEFAULT false,
	"min_approvals" integer DEFAULT 1,
	"environment" "deployment_environment" NOT NULL,
	"auto_merge_on_success" boolean DEFAULT false,
	"auto_delete_on_merge" boolean DEFAULT true,
	"environment_variables" jsonb,
	"builder_config_override" jsonb,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"account_avatar_url" text,
	"repositories_count" integer DEFAULT 0,
	"permissions" jsonb,
	"access_token_url" text,
	"html_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "github_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"repository_id" integer NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"private" boolean NOT NULL,
	"html_url" text NOT NULL,
	"description" text,
	"default_branch" text NOT NULL,
	"language" text,
	"forks_count" integer DEFAULT 0,
	"stargazers_count" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "github_repositories_repository_id_unique" UNIQUE("repository_id")
);
--> statement-breakpoint
ALTER TABLE "deployment_rules" ADD CONSTRAINT "deployment_rules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE cascade ON UPDATE no action;