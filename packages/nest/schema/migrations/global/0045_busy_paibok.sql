CREATE TABLE "access_request_votes" (
	"request_id" uuid NOT NULL,
	"approver_id" text NOT NULL,
	"decision" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "access_request_votes_request_id_approver_id_pk" PRIMARY KEY("request_id","approver_id")
);
--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permission" text NOT NULL,
	"requester_id" text NOT NULL,
	"via" text,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_hash" text NOT NULL,
	"reason" text NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ttl_sec" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_request_votes" ADD CONSTRAINT "access_request_votes_request_id_access_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."access_requests"("id") ON DELETE cascade ON UPDATE no action;