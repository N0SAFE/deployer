CREATE TABLE `cluster_node` (
        `id` integer PRIMARY KEY NOT NULL,
        `cluster_id` text,
        `local_node_state` text,
        `swarm_role` text,
        `platform_role` text DEFAULT 'both' NOT NULL,
        `is_master` integer DEFAULT 0 NOT NULL,
        `is_ingress` integer DEFAULT 0 NOT NULL,
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