import { AppError } from "@repo/errors";
import { Injectable, Logger } from '@nestjs/common'
import { Pool } from 'pg'
import { NodeConfigRepository } from '../../setup/repositories/node-config.repository'
import { AppLifecycleService, AppLifecyclePhase } from '@repo/nest-lifecycle'
import { DatabaseProbeService } from './database-probe.service'

@Injectable()
export class DatabaseStartupGuard {
  private readonly logger = new Logger(DatabaseStartupGuard.name)

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

    const client = await pool.connect().catch(() => null)
    if (client) {
      try {
        await client.query('SELECT 1')
        this.logger.log('✅ Database reachable')
        return
      } catch { /* fall through */ }
      finally { client.release() }
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
