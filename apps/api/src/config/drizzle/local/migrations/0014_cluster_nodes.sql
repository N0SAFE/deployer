CREATE TABLE `cluster_nodes` (
        `node_id` text PRIMARY KEY NOT NULL,
        `hostname` text DEFAULT '' NOT NULL,
        `swarm_role` text DEFAULT 'worker' NOT NULL,
        `platform_role` text DEFAULT 'both' NOT NULL,
        `is_leader` integer DEFAULT 0 NOT NULL,
        `is_ingress` integer DEFAULT 0 NOT NULL,
        `availability` text DEFAULT 'active' NOT NULL,
        `nano_cpus` integer,
        `memory_bytes` integer,
        `labels` text DEFAULT '{}' NOT NULL,
        `state` text DEFAULT 'active' NOT NULL,
        `last_seen_at` text NOT NULL,
        `updated_at` text NOT NULL
);