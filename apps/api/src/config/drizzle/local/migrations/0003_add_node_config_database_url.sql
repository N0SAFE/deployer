-- Add database_url column to node_config table
-- Nullable - null means not yet configured
ALTER TABLE node_config ADD COLUMN database_url TEXT;
