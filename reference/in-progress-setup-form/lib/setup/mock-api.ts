import type { RemoteUser } from "./types"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isLikelyValidUrl(value: string) {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export async function checkMeshReachability(url: string): Promise<{
  reachable: boolean
  meshName?: string
  nodeCount?: number
  latencyMs?: number
  error?: string
}> {
  await wait(800 + Math.random() * 400)

  if (!isLikelyValidUrl(url)) {
    return { reachable: false, error: "Invalid URL format" }
  }

  if (/fail|down|offline/i.test(url)) {
    return { reachable: false, error: "Mesh is not responding (timeout)" }
  }

  const seed = [...url].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const meshNames = ["aurora-mesh", "northwind", "polaris", "hyperion-net", "umbra-cluster"]
  return {
    reachable: true,
    meshName: meshNames[seed % meshNames.length],
    nodeCount: 3 + (seed % 12),
    latencyMs: 20 + (seed % 80),
  }
}

export async function checkPostgresReachability(connectionString: string): Promise<{
  reachable: boolean
  database?: string
  version?: string
  error?: string
}> {
  await wait(700 + Math.random() * 500)

  const trimmed = connectionString.trim()
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
    return {
      reachable: false,
      error: "Connection string must start with postgres:// or postgresql://",
    }
  }

  if (/fail|invalid|wrong/i.test(trimmed)) {
    return { reachable: false, error: "Authentication failed" }
  }

  let database = "postgres"
  try {
    const u = new URL(trimmed)
    const path = u.pathname.replace(/^\//, "")
    if (path) database = path
  } catch {
    // ignore
  }

  return {
    reachable: true,
    database,
    version: "PostgreSQL 16.2",
  }
}

export async function mockRemoteAuthenticate(meshUrl: string): Promise<{
  user: RemoteUser
  sessionToken: string
}> {
  await wait(1200)
  const seed = [...meshUrl].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const names = [
    { name: "Ada Lovelace", email: "ada@mesh.local" },
    { name: "Alan Turing", email: "alan@mesh.local" },
    { name: "Grace Hopper", email: "grace@mesh.local" },
    { name: "Linus Torvalds", email: "linus@mesh.local" },
  ]
  const pick = names[seed % names.length]
  const colors = ["#a78bfa", "#22d3ee", "#f59e0b", "#34d399"]
  return {
    user: {
      id: `usr_${seed.toString(36)}`,
      name: pick.name,
      email: pick.email,
      avatarColor: colors[seed % colors.length],
    },
    sessionToken: `tok_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
  }
}

export async function mockGenerateNodeId(): Promise<string> {
  await wait(400)
  return `node_${Math.random().toString(36).slice(2, 10)}`
}

export async function mockTaskDelay(min = 600, max = 1400) {
  await wait(min + Math.random() * (max - min))
}

// ---------- Task log templates ----------

export const taskLogs: Record<string, string[]> = {
  // Local — managed Postgres
  "create-db.managed": [
    "$ pg_ctl initdb -D /var/lib/mesh/pgdata --encoding=UTF8 --locale=en_US.UTF-8",
    "selecting dynamic shared memory implementation ... posix",
    "creating configuration files ... ok",
    "running bootstrap script ... ok",
    "performing post-bootstrap initialization ... ok",
    "syncing data to disk ... ok",
    "$ pg_ctl -D /var/lib/mesh/pgdata -l logfile start",
    "server started, listening on port 5432",
    "database 'mesh' created",
  ],
  // Local — existing Postgres
  "create-db.existing": [
    "Resolving connection target ...",
    "Establishing TCP connection to host:5432",
    "TLS handshake complete (TLSv1.3, AEAD-CHACHA20-POLY1305)",
    "Authenticated as role 'mesh'",
    "Server version: PostgreSQL 16.2",
    "Connection pool initialized (size=10)",
  ],
  migrate: [
    "Found 14 pending migrations",
    "[001] create_extension_uuid_ossp ............. ok (2ms)",
    "[002] create_table_nodes ..................... ok (8ms)",
    "[003] create_table_peers ..................... ok (5ms)",
    "[004] create_table_identities ................ ok (6ms)",
    "[005] create_table_audit_log ................. ok (4ms)",
    "[006] create_indexes_peers_lookup ............ ok (3ms)",
    "[007] seed_default_roles ..................... ok (1ms)",
    "All 14 migrations applied in 142ms",
  ],
  admin: [
    "Validating credentials against schema",
    "Hashing password with argon2id (m=64MB, t=3, p=4)",
    "Generated user ID: usr_8x2vk0pq",
    "INSERT INTO users (id, username, email, password_hash, role) VALUES ($1, $2, $3, $4, 'admin')",
    "Granting role 'admin' to user usr_8x2vk0pq",
    "Admin account created",
  ],
  keypair: [
    "Generating Ed25519 key pair",
    "Public key:  ed25519:GmK2x5Lp9...QzR7vN4eBcA",
    "Private key written to ~/.mesh/identity.key (mode 0600)",
    "Fingerprint: SHA256:8f4d1c9a...e6c2",
    "Identity registered in local keystore",
  ],
  mesh: [
    "Initializing mesh state machine",
    "Creating genesis block (height=0)",
    "Setting bootstrap policy: open",
    "Mesh ID: msh_aur0r4_l0c4l",
    "Registering this node as founding peer",
    "Mesh is online and ready to accept peers",
  ],
  persist: [
    "Opening local SQLite registry at ~/.mesh/registry.db",
    "PRAGMA journal_mode=WAL",
    "Writing node identity record",
    "Writing mesh metadata record",
    "Writing database connection record",
    "Sealing registry with HMAC-SHA256",
    "Registry committed (3 records, 4.2 KB)",
  ],
  // Remote
  "verify-token": [
    "POST /v1/auth/verify",
    "Validating signature against mesh public key",
    "Token issuer: aurora-mesh",
    "Token expires in 14 days",
    "Verification successful",
  ],
  "fetch-db": [
    "GET /v1/cluster/database",
    "Decrypting database URL with session key",
    "Connection target: postgres://****@cluster.local:5432/mesh",
    "Probing primary for liveness ... ok (12ms)",
    "Probing replica for read consistency ... ok",
  ],
  register: [
    "Broadcasting NODE_JOIN to 7 peers",
    "Peer 192.168.1.4:8080 acknowledged",
    "Peer 192.168.1.5:8080 acknowledged",
    "Peer 192.168.1.6:8080 acknowledged",
    "Peer 192.168.1.7:8080 acknowledged",
    "Quorum reached (5/7)",
    "Node admitted into mesh ring",
  ],
}
