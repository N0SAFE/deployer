import { AppError } from "@repo/errors";
import { Injectable, Logger } from '@nestjs/common'
import { Pool } from 'pg'
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository"
import { AppLifecycleService, AppLifecyclePhase } from '@repo/nest-lifecycle'
import { DatabaseProbeService } from './database-probe.service'

@Injectable()
export class DatabaseStartupGuard {
  private readonly logger = new Logger(DatabaseStartupGuard.name)

  /**
   * How long to keep retrying a database that is not reachable yet.
   *
   * The platform's database may be a SWARM SERVICE, which means its task is
   * scheduled asynchronously: right after swarm init (or after the service is
   * (re)created) the container exists but its overlay DNS name does not resolve
   * yet, and the name only appears once the task is running and the daemon has
   * published the endpoint. A single-shot check therefore fails at random —
   * observed in practice as `Hostname not resolved` on a boot where a manual
   * `getent hosts deployer-postgres` succeeded seconds later.
   *
   * Booting must therefore WAIT for its dependency to converge instead of
   * declaring the platform broken. The bound is generous enough to cover a
   * swarm task being placed and started, and still fails fast when the database
   * genuinely is not coming up.
   */
  private static readonly CONNECT_WAIT_MS = 60_000;

  /** Backoff between connectivity attempts. */
  private static readonly CONNECT_RETRY_MS = 2_000;

  constructor(
    private readonly nodeConfigRepository: NodeConfigRepository,
    private readonly lifecycle: AppLifecycleService,
    private readonly probeService: DatabaseProbeService,
  ) {}

  async ensureDatabaseAvailable(pool: Pool): Promise<void> {
    const url = this.nodeConfigRepository.find()?.databaseUrl?.trim()
    if (!url) {
      this.logger.log('⏭ No database URL configured — skipping startup guard')
      return
    }
    this.lifecycle.transition(AppLifecyclePhase.PROBING, { message: 'Testing database connectivity…' })

    const reachable = await this.tryPoolConnect(pool)
    if (reachable) {
      this.logger.log('✅ Database reachable')
      return
    }

    // Not reachable on the first try — almost always because the dependency is
    // still starting (swarm scheduling is asynchronous). Wait for it.
    if (await this.waitForDatabase(pool, url)) {
      this.logger.log('✅ Database reachable (after waiting for it to start)')
      return
    }

    const recovered = await this.tryDockerContainerRecovery()
    if (recovered) {
      this.logger.log('✅ Database recovered via Docker container restart')
      return
    }

    const probeResult = await this.probeService.probe(url)

    // If the probe succeeded but the global pool failed, the pool was created
    // with a stale/empty connection string (e.g. placeholder pool from module
    // init before the URL was written to SQLite). The app cannot recover the
    // pool at this point — fail with a clear diagnostic.
    if (probeResult.reachable) {
      const msg = 'Global database pool has wrong connection string (stale URL) — restart required'
      this.logger.error(msg)
      this.lifecycle.transition(AppLifecyclePhase.ERROR, { error: msg, databaseReachable: false })
      throw new AppError(msg, "DATABASE_STARTUP_BLOCKED")
    }

    const errorMessage = this.buildDiagnostic(url, probeResult.error ?? 'Unreachable')
    this.logger.error(errorMessage)
    this.lifecycle.transition(AppLifecyclePhase.ERROR, { error: errorMessage, databaseReachable: false })
    throw new AppError(errorMessage, "DATABASE_STARTUP_BLOCKED")
  }

  /**
   * One `SELECT 1` over the shared pool. `false` means "not usable right now"
   * (pool error, refused connection, unresolvable host, failing query) — the
   * caller decides whether that is fatal or just early.
   */
  private async tryPoolConnect(pool: Pool): Promise<boolean> {
    const client = await pool.connect().catch(() => null)
    if (!client) return false
    try {
      await client.query('SELECT 1')
      return true
    } catch {
      return false
    } finally {
      client.release()
    }
  }

  /**
   * Poll until the database answers or `CONNECT_WAIT_MS` elapses. Logs once at
   * the start (so a slow dependency is visible) rather than on every attempt.
   */
  private async waitForDatabase(pool: Pool, url: string): Promise<boolean> {
    const host = this.safeHost(url)
    this.logger.log(
      `⏳ Database at ${host} is not reachable yet — waiting up to ${String(DatabaseStartupGuard.CONNECT_WAIT_MS / 1000)}s for it to start…`,
    )

    const deadline = Date.now() + DatabaseStartupGuard.CONNECT_WAIT_MS
    let attempts = 0
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, DatabaseStartupGuard.CONNECT_RETRY_MS))
      attempts += 1
      if (await this.tryPoolConnect(pool)) {
        this.logger.log(`Database became reachable after ${String(attempts)} attempt(s)`)
        return true
      }
    }
    return false
  }

  /** Host:port of a connection string, for diagnostics (never the credentials). */
  private safeHost(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.hostname}:${parsed.port === '' ? '(default)' : parsed.port}`
    } catch {
      return '(unparseable connection string)'
    }
  }

  private async tryDockerContainerRecovery(): Promise<boolean> {
    try {
      const { default: Dockerode } = await import('dockerode')
      const container = new Dockerode().getContainer('deployer-postgres-dev')
      const info = await container.inspect()
      if (info.State.Running) return false
      this.logger.log('🔄 Restarting stopped Postgres container...')
      await container.start()
      for (let i = 0; i < 30; i++) {
        const r = await this.probeService.probe(this.nodeConfigRepository.find()?.databaseUrl ?? '', { timeout: 2_000 })
        if (r.reachable) return true
        await new Promise((r) => setTimeout(r, 1_000))
      }
      return false
    } catch {
      return false
    }
  }

  private buildDiagnostic(url: string, error: string): string {
    const redacted = url.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')
    return [
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '❌ DATABASE CONNECTION FAILED',
      `  URL: ${redacted}`,
      `  Error: ${error}`,
      '  Actions:',
      '  1. Check if Postgres is running: docker ps | grep postgres',
      '  2. Run: bun run db:setup --url="postgres://..."',
      '  3. Or reset and re-run setup wizard',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n')
  }
}
