CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('cpu', 'memory', 'storage', 'network', 'disk', 'health');--> statement-breakpoint
CREATE TABLE "metric_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stack_id" uuid,
	"aggregation_type" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"avg_cpu_usage" numeric(5, 2),
	"max_cpu_usage" numeric(5, 2),
	"min_cpu_usage" numeric(5, 2),
	"avg_memory_usage" numeric(12, 0),
	"max_memory_usage" numeric(12, 0),
	"min_memory_usage" numeric(12, 0),
	"avg_storage_usage" numeric(12, 0),
	"max_storage_usage" numeric(12, 0),
	"min_storage_usage" numeric(12, 0),
	"total_network_rx" numeric(12, 0),
	"total_network_tx" numeric(12, 0),
	"total_disk_read" numeric(12, 0),
	"total_disk_write" numeric(12, 0),
	"data_points" integer NOT NULL,
	"alert_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stack_id" uuid NOT NULL,
	"service_id" uuid,
	"alert_type" "alert_type" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"message" text NOT NULL,
	"threshold" numeric(10, 2) NOT NULL,
	"current_value" numeric(10, 2) NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stack_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stack_id" uuid NOT NULL,
	"service_id" uuid,
	"cpu_usage" numeric(5, 2),
	"memory_usage" numeric(12, 0),
	"memory_limit" numeric(12, 0),
	"storage_usage" numeric(12, 0),
	"network_rx" numeric(12, 0),
	"network_tx" numeric(12, 0),
	"disk_read" numeric(12, 0),
	"disk_write" numeric(12, 0),
	"metadata" jsonb,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metric_aggregates" ADD CONSTRAINT "metric_aggregates_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_alerts" ADD CONSTRAINT "resource_alerts_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_alerts" ADD CONSTRAINT "resource_alerts_service_id_service_instances_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_metrics" ADD CONSTRAINT "stack_metrics_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_metrics" ADD CONSTRAINT "stack_metrics_service_id_service_instances_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_instances"("id") ON DELETE cascade ON UPDATE no action;