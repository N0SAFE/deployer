CREATE TABLE "authz_epoch" (
	"id" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
