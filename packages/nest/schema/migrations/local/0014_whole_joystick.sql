ALTER TABLE `node_config` ADD `platform_secret_generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `node_config` ADD `platform_secret_previous` text;