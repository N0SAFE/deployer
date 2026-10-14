DROP INDEX "account_userId_idx";--> statement-breakpoint
DROP INDEX "invitation_organizationId_idx";--> statement-breakpoint
DROP INDEX "invitation_email_idx";--> statement-breakpoint
DROP INDEX "member_organizationId_idx";--> statement-breakpoint
DROP INDEX "member_userId_idx";--> statement-breakpoint
DROP INDEX "organization_slug_uidx";--> statement-breakpoint
DROP INDEX "organizationRole_organizationId_idx";--> statement-breakpoint
DROP INDEX "organizationRole_role_idx";--> statement-breakpoint
DROP INDEX "session_userId_idx";--> statement-breakpoint
DROP INDEX "team_organizationId_idx";--> statement-breakpoint
DROP INDEX "teamMember_teamId_idx";--> statement-breakpoint
DROP INDEX "teamMember_userId_idx";--> statement-breakpoint
DROP INDEX "verification_identifier_idx";--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "organization_role" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "member_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN "membership_key" text;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_membership_key_unique" UNIQUE("membership_key");