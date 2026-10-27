ALTER TYPE "public"."local_outbox_state" ADD VALUE 'dispatching' BEFORE 'sent';--> statement-breakpoint
ALTER TABLE "local_event_outbox" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "local_event_outbox" ADD COLUMN "locked_until" timestamp;--> statement-breakpoint
CREATE INDEX "local_event_outbox_claim_idx" ON "local_event_outbox" USING btree ("node_id","state","next_retry_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "local_event_outbox_event_id_key" ON "local_event_outbox" USING btree ("event_id") WHERE "local_event_outbox"."event_id" is not null;