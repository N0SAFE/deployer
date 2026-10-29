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
export type StoredCredential = { readonly secret: string; readonly swarmId: string | null; readonly installedAt: number };

export type AgentStoreShape = {
  /** This node's id: generated on first boot and the same ever after. */
  readonly identity: () => Effect.Effect<AgentIdentity, AgentStoreError>;
  /** The credential this node's agent answers to: its own until it joins a swarm, then the swarm's. */
  readonly credential: () => Effect.Effect<StoredCredential, AgentStoreError>;
  /** Adopts a swarm's credential, replacing the standalone one. */
  readonly installCredential: (secret: string, swarmId: string) => Effect.Effect<void, AgentStoreError>;
  /** The agents this node is meant to join, kept across restarts so a restarted agent rejoins by itself. */
  readonly seeds: () => Effect.Effect<readonly string[], AgentStoreError>;
  readonly addSeed: (address: string) => Effect.Effect<void, AgentStoreError>;
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
    identity: () =>
      attempt("identity", () => {
        const existing = handle.prepare("SELECT node_id, created_at FROM identity WHERE id = 1").get() as
          | { node_id: string; created_at: number }
          | undefined;
        if (existing) {
          return { nodeId: existing.node_id, createdAt: existing.created_at };
        }
        const created = { nodeId: `node-${randomUUID()}`, createdAt: now() };
        handle.prepare("INSERT INTO identity (id, node_id, created_at) VALUES (1, ?, ?)").run(created.nodeId, created.createdAt);
        return created;
      }),

    credential: () =>
      attempt("credential", () => {
        const existing = handle.prepare("SELECT secret, swarm_id, installed_at FROM credential WHERE id = 1").get() as
          | { secret: string; swarm_id: string | null; installed_at: number }
          | undefined;
        if (existing) {
          return { secret: existing.secret, swarmId: existing.swarm_id, installedAt: existing.installed_at };
        }
        // Standalone: a secret of its own, so nothing can reach the agent until a swarm's credential replaces it.
        const created = { secret: randomBytes(32).toString("base64url"), swarmId: null, installedAt: now() };
        handle
          .prepare("INSERT INTO credential (id, secret, swarm_id, installed_at) VALUES (1, ?, NULL, ?)")
          .run(created.secret, created.installedAt);
        return created;
      }),

    installCredential: (secret, swarmId) =>
      attempt("installCredential", () => {
        handle
          .prepare(
            `INSERT INTO credential (id, secret, swarm_id, installed_at) VALUES (1, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET secret = excluded.secret, swarm_id = excluded.swarm_id, installed_at = excluded.installed_at`,
          )
          .run(secret, swarmId, now());
      }),

    seeds: () =>
      attempt("seeds", () => (handle.prepare("SELECT address FROM seeds ORDER BY added_at, address").all() as { address: string }[]).map((row) => row.address)),

    addSeed: (address) =>
      attempt("addSeed", () => {
        handle.prepare("INSERT OR IGNORE INTO seeds (address, added_at) VALUES (?, ?)").run(address, now());
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
  return agentStoreOver(await openSqlite(path));
}

/** The node's own state, owned by its agent: identity, credential and the swarm it is meant to be part of. */
export class AgentStore extends Context.Service<AgentStore, AgentStoreShape>()("mesh-agent/AgentStore") {}
