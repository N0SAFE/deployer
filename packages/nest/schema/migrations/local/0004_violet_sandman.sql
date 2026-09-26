PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_node_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`strategy` text NOT NULL,
	`mesh_urls_snapshot` text,
	`database_url` text,
	`configured_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_node_config`("id", "node_id", "strategy", "mesh_urls_snapshot", "database_url", "configured_at", "updated_at") SELECT "id", "node_id", "strategy", "mesh_urls_snapshot", "database_url", "configured_at", "updated_at" FROM `node_config`;--> statement-breakpoint
DROP TABLE `node_config`;--> statement-breakpoint
ALTER TABLE `__new_node_config` RENAME TO `node_config`;--> statement-breakpoint
PRAGMA foreign_keys=ON;