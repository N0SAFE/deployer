import { Database } from "bun:sqlite";

const db = new Database("/app/data/local.db");

db.exec(`
CREATE TABLE IF NOT EXISTS node_config (
  id integer PRIMARY KEY,
  node_id text NOT NULL,
  strategy text NOT NULL,
  setup_state text NOT NULL DEFAULT 'not_started',
  deployer_version text,
  upgraded_at_version text,
  mesh_urls_snapshot text,
  database_url text,
  configured_at text,
  peer_service_token text,
  peer_service_token_expires_at text,
  updated_at text NOT NULL,
  mesh_shared_secret text,
  mesh_shared_secret_updated_at text,
  scanner_config text
)
`);

const now = new Date().toISOString();
const nodeId = crypto.randomUUID();
const version = "1.0.0";
const secret = crypto.randomUUID();

db.query(
  `INSERT INTO node_config (
     id, node_id, strategy, setup_state, deployer_version,
     database_url, configured_at, updated_at,
     mesh_shared_secret, mesh_shared_secret_updated_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     setup_state = excluded.setup_state,
     database_url = excluded.database_url,
     configured_at = excluded.configured_at,
     updated_at = excluded.updated_at
   `,
).run(1, nodeId, "local", "setup_done", version, process.env.DB_URL ?? "postgresql://deployer:deployer@172.18.0.1:32770/deployer", now, now, secret, now);

const row = db.query("SELECT node_id, setup_state, database_url FROM node_config WHERE id = 1").get();
console.log("seeded:", JSON.stringify(row));
