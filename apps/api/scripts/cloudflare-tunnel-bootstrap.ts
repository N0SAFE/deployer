/**
 * Cloudflare tunnel operator bootstrap — runs ONCE in the environment that
 * holds the REAL AUTH_SECRET (the one that provisioned the tunnel), because
 * the provider app credentials are encrypted with it.
 *
 * What it does (against the REAL Cloudflare account + tunnel):
 *   1. reads AUTH_SECRET (hex64) from the environment
 *   2. resolves the global DB URL (env GLOBAL_DATABASE_URL, else the local
 *      node_config in SQLite at NODE_LOCAL_DB_PATH)
 *   3. decrypts the Cloudflare app's API token from dns_providers
 *   4. prints the tunnel's live status + connection count + current ingress
 *   5. APPLIES the ingress rule: <hostname> → CLOUDFLARE_TUNNEL_SERVICE_URL
 *      (default http://deployer-traefik:80 — the platform Traefik, which
 *      routes the global hostname → the API) — this is what clears error 1033
 *   6. prints the cloudflared run token so a connector can be started
 *
 * Usage (inside the deployer / api container, or on the host with the prod
 * secrets in env):
 *   bun run tunnel:bootstrap [providerId] [tunnelId] [hostname]
 *
 * Verify:
 *   curl -I https://deployer.sebille.net   # 200 once cloudflared is running
 */
import { createDecipheriv } from "node:crypto";
import { Database } from "bun:sqlite";
import { Cloudflare } from "cloudflare";
import { Client as PgClient } from "pg";

const arg = (i: number, dflt: string) => process.argv[i]?.trim() || dflt;

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

// ─── 1. AUTH_SECRET (hex64) — the encryption key for provider credentials
const AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) fail("AUTH_SECRET is required (the key that encrypted the provider credentials).");
if (!/^[0-9a-fA-F]{64}$/.test(AUTH_SECRET)) {
  fail("AUTH_SECRET must be a 64-char hex string (32 bytes) — the value that provisioned the Cloudflare app.");
}

// ─── 2. Global DB URL — env override, else from local node_config SQLite
async function resolveGlobalDbUrl(): Promise<string> {
  if (process.env.GLOBAL_DATABASE_URL?.trim()) return process.env.GLOBAL_DATABASE_URL.trim();
  const dbPath = process.env.NODE_LOCAL_DB_PATH?.trim() || "/data/local.db";
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db.query("select database_url from node_config limit 1").get() as { database_url?: string | null } | null;
    db.close();
    if (row?.database_url?.trim()) return row.database_url.trim();
  } catch (e) {
    console.warn(`⚠ could not read ${dbPath}: ${(e as Error).message}`);
  }
  return fail("Could not resolve the global DB URL. Set GLOBAL_DATABASE_URL.");
}

function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4) fail("Invalid encrypted credentials format.");
  const [saltHex, ivHex, authTagHex, dataHex] = parts as [string, string, string, string];
  // The app derives ENCRYPTION_KEY = Buffer.from(AUTH_SECRET, "hex") directly.
  const key = Buffer.from(AUTH_SECRET, "hex");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(authTagHex, "hex"));
  return d.update(dataHex, "hex", "utf8") + d.final("utf8");
}

async function main(): Promise<void> {
  const providerId = arg(2, "eafed360-57a7-4cb7-9ef3-b94f1c575d52");
  const tunnelId = arg(3, "f4330659-dc10-4e24-8337-e459fb313b47");
  const hostname = arg(4, "deployer.sebille.net");
  const service = process.env.CLOUDFLARE_TUNNEL_SERVICE_URL?.trim() || "http://deployer-traefik:80";

  const dbUrl = await resolveGlobalDbUrl();
  const pool = new PgClient({ connectionString: dbUrl });
  await pool.connect();

  // ─── 3. Decrypt the provider token ────────────────────────────────────
  const prov = await pool.query("select name, credentials from dns_providers where id = $1", [providerId]);
  if (prov.rowCount !== 1) fail(`Provider ${providerId} not found in global DB.`);
  const creds = JSON.parse(decrypt(prov.rows[0].credentials)) as { apiToken?: string };
  const token = creds.apiToken;
  if (!token) fail("Provider has no apiToken in credentials.");

  // Node binding (hostname authoritative from DB when hostname arg is default)
  const bind = await pool.query(
    "select node_id, tunnel_hostname from node_network_config where tunnel_provider_id = $1 and tunnel_id = $2 and tunnel_enabled",
    [providerId, tunnelId],
  );
  if (bind.rowCount) {
    const dbHost = (bind.rows[0] as { tunnel_hostname: string | null }).tunnel_hostname;
    if (dbHost && process.argv[4] === undefined) console.log(`ℹ hostname from node_network_config: ${dbHost}`);
  }
  await pool.end();

  const client = new Cloudflare({ apiToken: token });

  // ─── 4. Tunnel live state ─────────────────────────────────────────────
  const accounts = await client.accounts.list({ page: 1, per_page: 1 });
  const accountId = accounts.result?.[0]?.id;
  if (!accountId) fail("No Cloudflare account found for this token.");
  console.log(`✔ account   : ${accountId}`);

  const tunnel = await client.zeroTrust.tunnels.cloudflared.get(tunnelId, { account_id: accountId });
  const conns = await client.zeroTrust.tunnels.cloudflared.connections.get(tunnelId, { account_id: accountId });
  console.log(`✔ tunnel    : ${tunnel.name ?? tunnelId}  status=${tunnel.status ?? "?"}  connections=${conns.result.length}`);

  try {
    const cfg = await client.zeroTrust.tunnels.cloudflared.configurations.get(tunnelId, { account_id: accountId });
    console.log(`✔ ingress   : ${JSON.stringify(cfg.config?.ingress ?? null)}`);
  } catch {
    console.log(`✔ ingress   : (no remote config yet — applying below)`);
  }

  // ─── 5. Apply the ingress rule (idempotent) — clears 1033 ─────────────
  await client.zeroTrust.tunnels.cloudflared.configurations.update(tunnelId, {
    account_id: accountId,
    config: { ingress: [{ hostname, service }] },
  });
  console.log(`✔ applied   : ${hostname} → ${service}`);

  // ─── 6. Run token for the connector ───────────────────────────────────
  const tok = await client.zeroTrust.tunnels.cloudflared.token.get(tunnelId, { account_id: accountId });

  console.log("\nRun the connector (compose sidecar `cloudflared`, or:)\n");
  console.log(`  cloudflared tunnel --no-autoupdate run --token "${tok.result}"\n`);
  console.log("Verify: curl -I https://deployer.sebille.net   → expect HTTP 200");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));