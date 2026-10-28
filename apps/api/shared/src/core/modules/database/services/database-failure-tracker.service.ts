import { Injectable, Logger, Inject } from '@nestjs/common'
import { Pool } from 'pg'
import { AppLifecycle, AppLifecyclePhase, type AppLifecycleShape } from "@deployer/lifecycle";

@Injectable()
export class DatabaseFailureTracker {
  private readonly logger = new Logger(DatabaseFailureTracker.name)
  private failureCount = 0
  private readonly threshold = 5
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(@Inject(AppLifecycle) private readonly lifecycle: AppLifecycleShape) {}

  recordFailure(pool: Pool): void {
    this.failureCount++
    if (this.failureCount >= this.threshold && this.lifecycle.stateNow().phase !== AppLifecyclePhase.DEGRADED) {
      this.logger.warn(`🚨 ${this.failureCount} consecutive DB failures — entering degraded mode`)
      this.lifecycle.transitionNow(AppLifecyclePhase.DEGRADED, {
        error: `${this.failureCount} consecutive database failures`,
        databaseReachable: false,
      })
      this.scheduleRecovery(pool)
    }
  }

  recordSuccess(): void {
    this.failureCount = 0
    if (this.lifecycle.stateNow().phase === AppLifecyclePhase.DEGRADED) {
      this.lifecycle.transitionNow(AppLifecyclePhase.READY, { databaseReachable: true })
    }
    if (this.recoveryTimer) { clearTimeout(this.recoveryTimer); this.recoveryTimer = null }
  }

  private scheduleRecovery(pool: Pool): void {
    const delay = Math.min(2_000 * Math.pow(2, this.failureCount - this.threshold), 30_000)
    this.recoveryTimer = setTimeout(async () => {
      try {
        const client = await pool.connect()
        await client.query('SELECT 1')
        client.release()
        this.recordSuccess()
      } catch { this.scheduleRecovery(pool) }
    }, delay)
  }
}
