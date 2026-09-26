ALTER TABLE `node_config` ADD `setup_state` text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE `node_config` ADD `deployer_version` text;--> statement-breakpoint
ALTER TABLE `node_config` ADD `upgraded_at_version` text;