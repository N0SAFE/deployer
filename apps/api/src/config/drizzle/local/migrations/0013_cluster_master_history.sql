CREATE TABLE `cluster_master_history` (
        `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        `node_id` text NOT NULL,
        `term` integer NOT NULL,
        `elected_at` text NOT NULL,
        `reason` text,
        `duration_ms` integer
);