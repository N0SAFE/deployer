-- Add post_setup_flags column to node_config
-- NOTE: scan_config was added by migration 0008. This migration previously
-- re-added it (duplicate column error swallowed by the old runner) — removed.
ALTER TABLE `node_config` ADD `post_setup_flags` text;