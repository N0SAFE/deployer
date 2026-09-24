CREATE TABLE `cluster_master_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`node_id` text NOT NULL,
	`term` integer NOT NULL,
	`elected_at` text NOT NULL,
	`reason` text,
	`duration_ms` integer
);
--> statement-breakpoint
CREATE TABLE `cluster_node` (
	`id` integer PRIMARY KEY NOT NULL,
	`cluster_id` text,
	`local_node_state` text,
	`swarm_role` text,
	`platform_role` text DEFAULT 'both' NOT NULL,
	`is_master` integer DEFAULT false NOT NULL,
	`is_ingress` integer DEFAULT false NOT NULL,
	`availability` text DEFAULT 'active' NOT NULL,
	`node_count` integer DEFAULT 0 NOT NULL,
	`manager_count` integer DEFAULT 0 NOT NULL,
	`master_node_id` text,
	`master_term` integer DEFAULT 0 NOT NULL,
	`join_token_worker` text,
	`join_token_manager` text,
	`last_heartbeat_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cluster_nodes` (
	`node_id` text PRIMARY KEY NOT NULL,
	`hostname` text DEFAULT '' NOT NULL,
	`swarm_role` text DEFAULT 'worker' NOT NULL,
	`platform_role` text DEFAULT 'both' NOT NULL,
	`is_leader` integer DEFAULT false NOT NULL,
	`is_ingress` integer DEFAULT false NOT NULL,
	`availability` text DEFAULT 'active' NOT NULL,
	`nano_cpus` integer,
	`memory_bytes` integer,
	`labels` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`last_seen_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `node_config` ADD `swarm_config` text;