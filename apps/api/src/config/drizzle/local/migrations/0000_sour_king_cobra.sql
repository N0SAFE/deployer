CREATE TABLE `node_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`database_url` text,
	`node_id` text NOT NULL,
	`configured_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `node_mesh_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`node_server_url` text,
	`bootstrap_peers_encrypted` text,
	`sync_interval_ms` integer DEFAULT 10000 NOT NULL,
	`trust_strict_min_ack_ratio` text DEFAULT '1' NOT NULL,
	`trust_strict_max_ack_age_seconds` integer DEFAULT 300 NOT NULL,
	`trust_strict_rollout_wave_size` integer DEFAULT 3 NOT NULL,
	`trust_strict_auto_rollback` integer DEFAULT false NOT NULL,
	`control_envelope_trust_required` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "singleton_check" CHECK("node_mesh_config"."id" = 1)
);
