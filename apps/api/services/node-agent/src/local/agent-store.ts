import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Context, Effect } from "effect";

import { domainError } from "@deployer/effect-core";

import { type SqliteHandle, openSqlite } from "./sqlite";

/** The node's local store could not be read or written. */
export class AgentStoreError extends domainError("AgentStoreError", "dependency_missing")<{
  readonly operation: string;
}>() {
  override publicMessage() {
    return `The node's local store failed during ${this.operation}`;
  }
}

export type AgentIdentity = { readonly nodeId: string; readonly createdAt: number };
/** One replicated setting: the API writes it here, gossip carries it to the other agents. */
export type StoredSetting = { readonly key: string; readonly value: string; readonly updatedAt: number };
export type StoredCredential = {
  readonly secret: string;
  readonly swarmId: string | null;
  /** When the current secret was installed: the rotation epoch, so an older rotation never wins. */
  readonly installedAt: number;
  /** The secret being rotated out, still accepted until `previousValidUntil`. Null outside a rotation. */
  readonly previousSecret: string | null;
  /** Epoch ms; the previous secret is refused from here on. Null when there is none. */
  readonly previousValidUntil: number | null;
};
export type StoredNodeConfig = { readonly config: string; readonly updatedAt: number };

export type AgentStoreShape = {
  /**
   * This node's id: generated on first boot and the same ever after.
   *
   * `seedId` only decides the id of a store that has none yet (a dev pin, a test). Once the row exists the store wins,
   * so removing the pin later does not turn the node into a different node.
   */
  readonly identity: (seedId?: string) => Effect.Effect<AgentIdentity, AgentStoreError>;
  /** The credential this node's agent answers to: its own until it joins a swarm, then the swarm's. */
  readonly credential: () => Effect.Effect<StoredCredential, AgentStoreError>;
  /** Adopts a swarm's credential, replacing the standalone one. A join: any earlier rotation is dropped. */
  readonly installCredential: (secret: string, swarmId: string | null) => Effect.Effect<void, AgentStoreError>;
  /**
   * Rotates the credential in place: the current secret becomes the previous one, accepted until `validUntil`. The
   * swarm id is untouched — a rotation never moves a node between swarms. `installedAt` is the epoch, kept exact when
   * adopting a rotation learned from a peer.
   */
  readonly rotateCredential: (
    secret: string,
    validUntil: number,
    installedAt?: number,
    previousSecret?: string,
  ) => Effect.Effect<void, AgentStoreError>;
  /** The agents this node is meant to join, kept across restarts so a restarted agent rejoins by itself. */
  readonly seeds: () => Effect.Effect<readonly string[], AgentStoreError>;
  readonly addSeed: (address: string) => Effect.Effect<void, AgentStoreError>;
  /** A roster setting this agent acts on (the API publishes them; `node.doors` is the first). */
  readonly setting: (key: string) => Effect.Effect<string | undefined, AgentStoreError>;
  readonly settings: () => Effect.Effect<readonly StoredSetting[], AgentStoreError>;
  /** `updatedAt` defaults to now; gossip passes the writer's clock so the newest value wins. */
  readonly putSetting: (key: string, value: string, updatedAt?: number) => Effect.Effect<void, AgentStoreError>;
  /** Marks a join token as revoked, so `roster.check` and `roster.join` refuse it even before it expires. */
  readonly revokeToken: (token: string) => Effect.Effect<void, AgentStoreError>;
  readonly isTokenRevoked: (token: string) => Effect.Effect<boolean, AgentStoreError>;
  /**
   * Nodes this agent refuses: it forgets them and absorbs nothing they gossip, whatever credential they hold. Unlike a
   * revoked join token, a block outlives the token, so a revoked node cannot rejoin by minting a new one.
   */
  readonly blockNode: (nodeId: string) => Effect.Effect<void, AgentStoreError>;
  readonly unblockNode: (nodeId: string) => Effect.Effect<void, AgentStoreError>;
  readonly blockedNodes: () => Effect.Effect<readonly string[], AgentStoreError>;
  /**
   * This node's configuration, as JSON, or null while the node has never been configured.
   *
   * Written only through `node.configure`, so a node is created by a write to its database — never by a variable in its
   * environment. Local: unlike `settings`, it is never gossiped.
   */
  readonly nodeConfig: () => Effect.Effect<StoredNodeConfig | null, AgentStoreError>;
  readonly putNodeConfig: (config: string, updatedAt?: number) => Effect.Effect<void, AgentStoreError>;
  /** A durable secret this agent generated (the WireGuard private key, the overlay address salt). */
  readonly secret: (name: string) => Effect.Effect<string | undefined, AgentStoreError>;
  readonly putSecret: (name: string, value: string) => Effect.Effect<void, AgentStoreError>;
  readonly close: () => Effect.Effect<void>;
};

/**
 * Schema steps, applied in order and recorded in `PRAGMA user_version`. A step is never edited once shipped: a change
 * is a new step, so every node, whatever version it last ran, reaches the same schema.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE identity (id INTEGER PRIMARY KEY CHECK (id = 1), node_id TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE credential (id INTEGER PRIMARY KEY CHECK (id = 1), secret TEXT NOT NULL, swarm_id TEXT, installed_at INTEGER NOT NULL);
   CREATE TABLE seeds (address TEXT PRIMARY KEY, added_at INTEGER NOT NULL);`,
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);`,
  `CREATE TABLE revoked_tokens (token TEXT PRIMARY KEY, revoked_at INTEGER NOT NULL);`,
  `CREATE TABLE node_config (id INTEGER PRIMARY KEY CHECK (id = 1), config TEXT NOT NULL, updated_at INTEGER NOT NULL);`,
  `CREATE TABLE secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL);`,
  `CREATE TABLE blocked_nodes (node_id TEXT PRIMARY KEY, blocked_at INTEGER NOT NULL);`,
  // A rotation keeps the secret it replaces for a grace window, so a peer that has not learned the new one yet still
  // opens its connection.
  `ALTER TABLE credential ADD COLUMN previous_secret TEXT;
   ALTER TABLE credential ADD COLUMN previous_valid_until INTEGER;`,
];

function migrate(handle: SqliteHandle): void {
  const row = handle.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version += 1) {
    handle.exec("BEGIN");
    try {
      handle.exec(MIGRATIONS[version] ?? "");
      handle.exec(`PRAGMA user_version = ${String(version + 1)}`);
      handle.exec("COMMIT");
    } catch (error) {
      handle.exec("ROLLBACK");
      throw error;
    }
  }
}

const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({ try: run, catch: (cause) => new AgentStoreError({ operation, cause }) });

/** Store over an open handle. Separate from `openAgentStore` so a test gives it an in-memory database. */
export function agentStoreOver(handle: SqliteHandle, now: () => number = () => Date.now()): AgentStoreShape {
  migrate(handle);

  return {
    identity: (seedId) =>
      attempt("identity", () => {
        const existing = handle.prepare("SELECT node_id, created_at FROM identity WHERE id = 1").get() as
          | { node_id: string; created_at: number }
          | undefined;
        if (existing) {
          return { nodeId: existing.node_id, createdAt: existing.created_at };
        }
        const created = { nodeId: seedId ?? `node-${randomUUID()}`, createdAt: now() };
        handle.prepare("INSERT INTO identity (id, node_id, created_at) VALUES (1, ?, ?)").run(created.nodeId, created.createdAt);
        return created;
      }),

    credential: () =>
      attempt("credential", () => {
        const existing = handle
          .prepare("SELECT secret, swarm_id, installed_at, previous_secret, previous_valid_until FROM credential WHERE id = 1")
          .get() as
          | {
              secret: string;
              swarm_id: string | null;
              installed_at: number;
              previous_secret: string | null;
              previous_valid_until: number | null;
            }
          | undefined;
        if (existing) {
          return {
            secret: existing.secret,
            swarmId: existing.swarm_id,
            installedAt: existing.installed_at,
            previousSecret: existing.previous_secret,
            previousValidUntil: existing.previous_valid_until,
          };
        }
        // Standalone: a secret of its own, so nothing can reach the agent until a swarm's credential replaces it.
        const created = {
          secret: randomBytes(32).toString("base64url"),
          swarmId: null,
          installedAt: now(),
          previousSecret: null,
          previousValidUntil: null,
        };
        handle
          .prepare("INSERT INTO credential (id, secret, swarm_id, installed_at) VALUES (1, ?, NULL, ?)")
          .run(created.secret, created.installedAt);
        return created;
      }),

    installCredential: (secret, swarmId) =>
      attempt("installCredential", () => {
        // A join starts a new membership, so nothing of an earlier swarm's rotation survives it.
        handle
          .prepare(
            `INSERT INTO credential (id, secret, swarm_id, installed_at, previous_secret, previous_valid_until) VALUES (1, ?, ?, ?, NULL, NULL)
             ON CONFLICT (id) DO UPDATE SET secret = excluded.secret, swarm_id = excluded.swarm_id, installed_at = excluded.installed_at,
               previous_secret = NULL, previous_valid_until = NULL`,
          )
          .run(secret, swarmId, now());
      }),

    rotateCredential: (secret, validUntil, installedAt, previousSecret) =>
      attempt("rotateCredential", () => {
        // The previous secret is the one the caller's cell held, not necessarily the row's: a dev-pinned secret lives in
        // the cell without being written, and rotating it must still leave the old one verifiable during the window.
        handle
          .prepare(
            `INSERT INTO credential (id, secret, swarm_id, installed_at, previous_secret, previous_valid_until) VALUES (1, ?, NULL, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET previous_secret = COALESCE(?, credential.secret), previous_valid_until = excluded.previous_valid_until,
               secret = excluded.secret, installed_at = excluded.installed_at`,
          )
          .run(secret, installedAt ?? now(), previousSecret ?? null, validUntil, previousSecret ?? null);
      }),

    seeds: () =>
      attempt("seeds", () => (handle.prepare("SELECT address FROM seeds ORDER BY added_at, address").all() as { address: string }[]).map((row) => row.address)),

    addSeed: (address) =>
      attempt("addSeed", () => {
        handle.prepare("INSERT OR IGNORE INTO seeds (address, added_at) VALUES (?, ?)").run(address, now());
      }),

    setting: (key) =>
      attempt("setting", () => {
        const row = handle.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
        return row?.value;
      }),

    settings: () =>
      attempt("settings", () =>
        handle.prepare("SELECT key, value, updated_at FROM settings ORDER BY key").all() as {
          key: string;
          value: string;
          updated_at: number;
        }[]).pipe(
        Effect.map((rows) => rows.map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at }))),
      ),

    putSetting: (key, value, updatedAt) =>
      attempt("putSetting", () => {
        handle
          .prepare(
            `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          )
          .run(key, value, updatedAt ?? now());
      }),

    revokeToken: (token) =>
      attempt("revokeToken", () => {
        handle.prepare("INSERT OR IGNORE INTO revoked_tokens (token, revoked_at) VALUES (?, ?)").run(token, now());
      }),

    isTokenRevoked: (token) =>
      attempt("isTokenRevoked", () => {
        const row = handle.prepare("SELECT 1 AS revoked FROM revoked_tokens WHERE token = ?").get(token) as
          | { revoked: number }
          | undefined;
        // `bun:sqlite` returns null for no row, `node:sqlite` undefined: both mean "not revoked".
        return row !== null && row !== undefined;
      }),

    blockNode: (nodeId) =>
      attempt("blockNode", () => {
        handle.prepare("INSERT OR IGNORE INTO blocked_nodes (node_id, blocked_at) VALUES (?, ?)").run(nodeId, now());
      }),

    unblockNode: (nodeId) =>
      attempt("unblockNode", () => {
        handle.prepare("DELETE FROM blocked_nodes WHERE node_id = ?").run(nodeId);
      }),

    blockedNodes: () =>
      attempt("blockedNodes", () =>
        (handle.prepare("SELECT node_id FROM blocked_nodes ORDER BY node_id").all() as { node_id: string }[]).map(
          (row) => row.node_id,
        ),
      ),

    nodeConfig: () =>
      attempt("nodeConfig", () => {
        const row = handle.prepare("SELECT config, updated_at FROM node_config WHERE id = 1").get() as
          | { config: string; updated_at: number }
          | undefined;
        return row ? { config: row.config, updatedAt: row.updated_at } : null;
      }),

    putNodeConfig: (config, updatedAt) =>
      attempt("putNodeConfig", () => {
        handle
          .prepare(
            `INSERT INTO node_config (id, config, updated_at) VALUES (1, ?, ?)
             ON CONFLICT (id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
          )
          .run(config, updatedAt ?? now());
      }),

    secret: (name) =>
      attempt("secret", () => {
        const row = handle.prepare("SELECT value FROM secrets WHERE name = ?").get(name) as { value: string } | undefined;
        return row?.value;
      }),

    putSecret: (name, value) =>
      attempt("putSecret", () => {
        handle
          .prepare(
            `INSERT INTO secrets (name, value, created_at) VALUES (?, ?, ?)
             ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
          )
          .run(name, value, now());
      }),

    close: () => Effect.sync(() => { handle.close(); }),
  };
}

/** Opens (creating the directory with owner-only permissions) the agent's file in `directory` and migrates it. */
export async function openAgentStore(directory: string, fileName = "agent.db"): Promise<AgentStoreShape> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = `${directory}/${fileName}`;
  mkdirSync(dirname(path), { recursive: true });
  const handle = await openSqlite(path);
  // The file holds this node's credential: owner-only, like the directory. A new file is created here, so the chmod
  // runs after the open; the pragmas were already applied by `openSqlite`.
  chmodSync(path, 0o600);
  return agentStoreOver(handle);
}

/** The node's own state, owned by its agent: identity, credential and the swarm it is meant to be part of. */
export class AgentStore extends Context.Service<AgentStore, AgentStoreShape>()("node-agent/AgentStore") {}
