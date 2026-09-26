-- Migration: Add strategy and meshUrlsSnapshot columns to node_config
-- These columns exist in the Drizzle schema but were missing from the initial migration

ALTER TABLE `node_config` ADD COLUMN `strategy` text NOT NULL DEFAULT 'local';
ALTER TABLE `node_config` ADD COLUMN `mesh_urls_snapshot` text;