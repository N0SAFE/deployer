import { Command, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@/config/env/env.service';
import { GlobalDatabaseService } from '@/core/modules/database/global/global-database.service';
import { sql, eq } from 'drizzle-orm';
import * as schema from '@/config/drizzle/global/schema';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/*
 * ─── Exit codes ──────────────────────────────────────────────────────────────
 *
 *  0  Success
 *  1  Configuration error (bad/incomplete env vars)
 *  2  DB connectivity error (global Postgres unreachable)
 *  3  Schema error (required tables don't exist — migrations needed)
 *  4  Registration error (insert/update conflict that can't be resolved)
 *  5  Registration DENIED — registration guard blocked the node
 *       Reason: NODE_TOO_OLD — code missing migrations already applied to DB
 *       Reason: MANIFEST_OUTDATED — manifest currentSchemaVersion behind DB
 *       Reason: MANIFEST_MISSING_OR_INVALID — manifest file missing/corrupted
 */

const UUID_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Resolve app version from package.json at build time
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_VERSION: string = (() => {
  try {
    const pkgPath = join(__dirname, '..', '..', '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    return JSON.parse(raw).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// Migration manifest path (resolved relative to package.json)
const MANIFEST_PATH = join(
  __dirname, '..', '..', '..',
  'src', 'config', 'drizzle', 'global', 'migrations', 'migration-manifest.json'
);

@Command({
  name: 'register-mesh-node',
  description: 'Register mesh node in global DB and report schema version',
})
@Injectable()
export class RegisterMeshNodeCommand extends CommandRunner {
  private readonly logger = new Logger(RegisterMeshNodeCommand.name);

  constructor(
    private readonly databaseService: GlobalDatabaseService,
    private readonly envService: EnvService,
  ) {
    super();
  }

  /*
   * ─── Run ─────────────────────────────────────────────────────────────────────
   *
   * Called from entrypoint.dev.ts / entrypoint.prod.ts via:
   *   bun --bun src/cli.ts register-mesh-node
   *
   * Lifecycle: validate → check DB → check schema → registration guard →
   *            register → report version → check peers.
   * Every phase produces a clear exit code + log message so callers can decide
   * whether to retry, escalate, or ignore.
   */
  async run(): Promise<void> {
    // ── Phase 1: Pre-flight (no DB) ────────────────────────────────────────
    const config = this.parseConfig();
    if (!config) {
      process.exit(0); // graceful skip, not an error
    }
    /* c8 ignore next */
    const cfg = config!;

    this.logger.log(`🌐 Mesh node registration starting: ${cfg.nodeId}`);

    // ── Phase 2: DB connectivity ──────────────────────────────────────────
    const dbReady = await this.checkDbConnectivity();
    if (!dbReady) {
      this.logger.warn(
        `⚠️  Cannot reach global Postgres — DB not ready yet. ` +
        `The caller (entrypoint) should retry when the DB service is healthy.`
      );
      process.exit(2);
    }

    // ── Phase 3: Schema readiness ─────────────────────────────────────────
    const schemaReady = await this.checkSchemaReadiness();
    if (!schemaReady) {
      this.logger.warn(
        `⚠️  Global DB is reachable but required tables don't exist. ` +
        `Run database migrations first.`
      );
      process.exit(3);
    }

    // ── Phase 3.5: Registration Guard 🛡️ ──────────────────────────────────
    const guardResult = await this.runRegistrationGuard();
    if (!guardResult.allowed) {
      this.logger.error(`❌ REGISTRATION DENIED: ${guardResult.reason}`);
      for (const line of guardResult.detail) {
        this.logger.error(`   ${line}`);
      }
      this.logger.error(`   Action: ${guardResult.action}`);
      process.exit(5);
    }

    // ── Phase 4: Registration (idempotent) ────────────────────────────────
    const registered = await this.registerNode(cfg);
    if (!registered) {
      process.exit(4);
    }

    // ── Phase 5: Schema version reporting ─────────────────────────────────
    await this.reportSchemaVersion(cfg.nodeId);

    // ── Phase 6: Peer consistency check (informational) ───────────────────
    await this.checkPeerConsistency(cfg.nodeId);

    this.logger.log(`✅ Mesh node registration complete: ${cfg.nodeId}`);
  }

  /*
   * ─── Phase 1: Pre-flight ────────────────────────────────────────────────────
   *
   * Validates environment variables without any network/DB access.
   * Returns null if the node should not be registered (graceful skip).
   */
  private parseConfig(): { nodeId: string; serverUrl: string } | null {
    const nodeId = this.envService.get('MESH_NODE_ID')?.toString().trim();

    if (!nodeId) {
      this.logger.log('⏭️  Skipping: MESH_NODE_ID is not set');
      return null;
    }

    if (!UUID_LIKE_REGEX.test(nodeId)) {
      this.logger.log(`⏭️  Skipping: MESH_NODE_ID "${nodeId}" is not a valid UUID`);
      return null;
    }

    const serverUrlRaw =
      this.envService.get('MESH_NODE_SERVER_URL')?.toString().trim()
      ?? this.envService.get('APP_URL')?.toString().trim()
      ?? null;

    if (!serverUrlRaw) {
      this.logger.warn(
        `⚠️  Neither MESH_NODE_SERVER_URL nor APP_URL is set — ` +
        `falling back to default http://api:${this.envService.get('API_PORT')}`
      );
    }

    const serverUrl = serverUrlRaw
      ? this.toNodeServerUrl(serverUrlRaw)
      : `http://api:${this.envService.get('API_PORT').toString().trim()}`;

    return { nodeId, serverUrl };
  }

  /*
   * ─── Phase 2: DB connectivity ───────────────────────────────────────────────
   *
   * Attempts a lightweight query to confirm the global Postgres is reachable.
   * Distinguishes between transient (network) and permanent (config/auth) errors.
   */
  private async checkDbConnectivity(): Promise<boolean> {
    try {
      await this.databaseService.db.execute(sql`SELECT 1`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Auth / config errors are permanent — log them clearly
      if (message.includes('password') || message.includes('auth') || message.includes('role')) {
        this.logger.error(`❌ Global DB authentication failed: ${message}`);
        return false;
      }

      if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('ETIMEDOUT')) {
        this.logger.warn(`⚠️  Global DB unreachable (transient): ${message}`);
        return false;
      }

      this.logger.warn(`⚠️  Global DB connectivity check failed: ${message}`);
      return false;
    }
  }

  /*
   * ─── Phase 3: Schema readiness ──────────────────────────────────────────────
   *
   * Verifies that the tables this command depends on actually exist.
   * If they don't, migrations haven't run yet — no point in continuing.
   */
  private async checkSchemaReadiness(): Promise<boolean> {
    try {
      const result = await this.databaseService.db.execute<{ exists: boolean }>(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'cluster_nodes'
        ) AS exists
      `);
      const tableExists = result.rows[0]?.exists ?? false;

      if (!tableExists) {
        this.logger.warn(
          `⚠️  Table "cluster_nodes" does not exist in the global DB. ` +
          `This means database migrations have not been applied yet.`
        );
        return false;
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️  Could not verify schema readiness: ${message}`);
      return false;
    }
  }

  /*
   * ─── Phase 4: Registration (idempotent) ────────────────────────────────────
   *
   * Checks if the node is already registered. If so, refreshes its metadata.
   * If not, inserts a new row.
   *
   * This is intentionally NOT wrapped in a blanket catch — every error path
   * is handled explicitly so callers know exactly what went wrong.
   */
  private async registerNode(config: { nodeId: string; serverUrl: string }): Promise<boolean> {
    try {
      // ── 4a. Read existing ──────────────────────────────────────────────
      const existing = await this.databaseService.db
        .select({ nodeId: schema.clusterNodes.nodeId })
        .from(schema.clusterNodes)
        .where(eq(schema.clusterNodes.nodeId, config.nodeId))
        .limit(1);

      // ── 4b. Already registered → refresh ──────────────────────────────
      if (existing.length > 0) {
        this.logger.log(`✅ Mesh node already registered: ${config.nodeId}`);
        return true;
      }

      // ── 4c. Not registered → insert ───────────────────────────────────
      await this.databaseService.db.insert(schema.clusterNodes).values({
        nodeId: config.nodeId,
        serverUrl: config.serverUrl,
        status: 'active',
        healthy: true,
        metadata: { source: 'startup-bootstrap' },
        lastSeenAt: new Date(),
      });

      this.logger.log(`✅ Registered mesh node: ${config.nodeId} (${config.serverUrl})`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Unique violation — another node just registered with the same ID
      if (message.includes('duplicate key') || message.includes('unique constraint') || message.includes('23505')) {
        this.logger.warn(
          `⚠️  Node ${config.nodeId} was just registered by a concurrent process. ` +
          `This is harmless — treating as already-registered.`
        );
        return true; // treat as success — the row exists
      }

      // Connection lost mid-operation
      if (message.includes('ECONNREFUSED') || message.includes('connection') || message.includes('socket')) {
        this.logger.error(
          `❌ Lost connection to global DB while registering node ${config.nodeId}: ${message}`
        );
        return false;
      }

      // Anything else — real failure
      this.logger.error(
        `❌ Failed to register mesh node ${config.nodeId}: ${message}`
      );
      return false;
    }
  }

  /*
   * ─── Phase 5: Schema version reporting ───────────────────────────────────────
   *
   * Reads the applied migrations from Drizzle's meta table and writes the
   * current state to schema_version. This is non-critical — the registration
   * is the important part. If this fails, we log a warning but don't abort.
   */
  private async reportSchemaVersion(nodeId: string): Promise<void> {
    try {
      // 5a. Read applied migrations from Drizzle meta table
      let appliedVersions: string[];
      try {
        const migrations = await this.databaseService.db.execute<{ version: string }>(
          sql`SELECT version FROM "__drizzle_migrations" ORDER BY version`
        );
        appliedVersions = migrations.rows.map(r => r.version);
      } catch {
        // __drizzle_migrations table might not exist yet (fresh DB, no migrations)
        this.logger.log(`ℹ️  No __drizzle_migrations table found — no migrations have been applied yet`);
        appliedVersions = [];
      }

      const latestVersion = appliedVersions.at(-1) ?? '0000';

      // 5b. Upsert into schema_version
      try {
        await this.databaseService.db.execute(sql`
          INSERT INTO schema_version (node_id, schema_version, applied_migrations, app_version, last_verification)
          VALUES (
            ${nodeId},
            ${latestVersion},
            ${JSON.stringify(appliedVersions)},
            ${this.getAppVersion()},
            NOW()
          )
          ON CONFLICT (node_id) DO UPDATE SET
            schema_version = EXCLUDED.schema_version,
            applied_migrations = EXCLUDED.applied_migrations,
            app_version = EXCLUDED.app_version,
            last_verification = NOW(),
            updated_at = NOW()
        `);
        this.logger.log(`📋 Schema version reported: ${latestVersion} (${appliedVersions.length} migration(s) applied)`);
      } catch {
        this.logger.warn(`⚠️  Could not report schema version — schema_version table may not exist yet`);
      }
    } catch (error) {
      // Safety net — should never reach here given the inner catches
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️  Schema version reporting skipped: ${message}`);
    }
  }

  /*
   * ─── Phase 6: Peer consistency check ────────────────────────────────────────
   *
   * Queries all other nodes' schema versions and reports any mismatch.
   * Pure informational — never blocks or fails the command.
   */
  private async checkPeerConsistency(nodeId: string): Promise<void> {
    try {
      const peers = await this.databaseService.db.execute<{
        node_id: string;
        schema_version: string;
        app_version: string;
        last_verification: Date;
      }>(sql`
        SELECT node_id, schema_version, app_version, last_verification
        FROM schema_version
        WHERE node_id != ${nodeId}
        ORDER BY last_verification DESC
      `);

      if (peers.rows.length === 0) {
        this.logger.log(`ℹ️  No peer nodes found in schema_version — this is the first node`);
        return;
      }

      // Get this node's current version
      const myVersion = peers.rows.find(
        r => r.node_id === nodeId
      )?.schema_version;

      // Compare each peer
      const mismatches: string[] = [];
      for (const peer of peers.rows) {
        if (myVersion && peer.schema_version !== myVersion) {
          mismatches.push(
            `${peer.node_id} (${peer.schema_version}, last seen ${peer.last_verification.toISOString()})`
          );
        }
      }

      if (mismatches.length > 0) {
        this.logger.warn(
          `⚠️  Schema version mismatch detected across the cluster:\n` +
          mismatches.map(m => `  • ${m}`).join('\n')
        );
      } else {
        this.logger.log(`✅ All ${peers.rows.length} peer node(s) are on schema version ${myVersion ?? 'unknown'}`);
      }
    } catch (error) {
      // schema_version table may not exist yet — that's fine
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Peer consistency check skipped: ${message}`);
    }
  }

  /*
   * ─── Phase 3.5: Registration Guard ──────────────────────────────────────────
   *
   * Validates that this node's code contains ALL migrations already applied
   * to the global DB. Prevents outdated code from operating on an incompatible
   * schema. Also validates that the migration manifest's currentSchemaVersion
   * is not behind the DB's actual applied version.
   *
   * Returns { allowed: true } if the guard passes, or { allowed: false, reason,
   * detail, action } with a human-readable explanation.
   */
  private async runRegistrationGuard(): Promise<
    { allowed: true }
    | { allowed: false; reason: string; detail: string[]; action: string }
  > {
    // 1. Load migration manifest from disk
    let manifest: {
      currentSchemaVersion: string
      migrations: Array<{ version: string; name: string }>
    }
    try {
      const raw = readFileSync(MANIFEST_PATH, 'utf-8')
      manifest = JSON.parse(raw)
      if (!manifest.migrations || !Array.isArray(manifest.migrations)) {
        throw new Error('Manifest has no migrations array')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        allowed: false,
        reason: 'MANIFEST_MISSING_OR_INVALID',
        detail: [
          `Migration manifest at ${MANIFEST_PATH} could not be read or parsed.`,
          `Error: ${message}`,
        ],
        action: 'Ensure migration-manifest.json exists and is valid JSON.',
      }
    }

    // 2. Load applied migrations from the DB
    let dbAppliedVersions: string[]
    try {
      const migrations = await this.databaseService.db.execute<{ version: string }>(
        sql`SELECT version FROM "__drizzle_migrations" ORDER BY version`
      )
      dbAppliedVersions = migrations.rows.map(r => r.version)
    } catch {
      // __drizzle_migrations doesn't exist yet — no migrations applied
      this.logger.log('ℹ️  No __drizzle_migrations table — no migrations have been applied yet')
      return { allowed: true }
    }

    if (dbAppliedVersions.length === 0) {
      this.logger.log('ℹ️  No migrations applied in the global DB yet — guard passes trivially')
      return { allowed: true }
    }

    // 3. Check: every DB-applied migration must exist in the manifest
    const manifestVersions = new Set(manifest.migrations.map(m => m.version))
    const missingFromCode = dbAppliedVersions.filter(v => !manifestVersions.has(v))

    if (missingFromCode.length > 0) {
      const missingNames = missingFromCode.map(v => {
        const entry = manifest.migrations.find(m => m.version === v)
        return entry ? `${v}_${entry.name}` : v
      })
      return {
        allowed: false,
        reason: 'NODE_TOO_OLD',
        detail: [
          `This node's code is missing migrations already applied to the global DB:`,
          ...missingNames.map(n => `  • ${n}`),
          ``,
          `Current cluster schema version: ${dbAppliedVersions.at(-1)}`,
          `This node's max schema version: ${manifest.currentSchemaVersion}`,
        ],
        action: `Deploy app version that includes migrations ${missingNames.join(', ')} before this node can join.`,
      }
    }

    // 4. Check: manifest.currentSchemaVersion >= max DB version
    const dbMaxVersion = dbAppliedVersions.at(-1) ?? '0000'
    if (this.compareVersionStrings(dbMaxVersion, manifest.currentSchemaVersion) > 0) {
      return {
        allowed: false,
        reason: 'MANIFEST_OUTDATED',
        detail: [
          `Migration manifest declares currentSchemaVersion as "${manifest.currentSchemaVersion}"`,
          `but the global DB has migrations up to "${dbMaxVersion}" applied.`,
          `The manifest is out of date.`,
        ],
        action: `Update currentSchemaVersion in migration-manifest.json to "${dbMaxVersion}" and ensure all migration files exist.`,
      }
    }

    this.logger.log(
      `✅ Registration guard passed — ${dbAppliedVersions.length} migration(s) checked, ` +
      `cluster at ${dbMaxVersion}, manifest at ${manifest.currentSchemaVersion}`
    )
    return { allowed: true }
  }

  /**
   * Compare two 4-digit migration version strings numerically.
   * Returns negative if a < b, positive if a > b, 0 if equal.
   */
  private compareVersionStrings(a: string, b: string): number {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    if (isNaN(na) || isNaN(nb)) {
      // Fallback to string comparison if parsing fails
      return a.localeCompare(b)
    }
    return na - nb
  }

  /*
   * ─── Helpers ─────────────────────────────────────────────────────────────────
   */

  private getAppVersion(): string {
    return APP_VERSION;
  }

  private toNodeServerUrl(input: string): string {
    try {
      const parsed = new URL(input);
      if (parsed.protocol === 'ws:') {
        return `http://${parsed.host}`;
      }
      if (parsed.protocol === 'wss:') {
        return `https://${parsed.host}`;
      }
      return parsed.origin;
    } catch {
      return input;
    }
  }
}
