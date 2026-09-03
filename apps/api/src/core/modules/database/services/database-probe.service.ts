import { Injectable, Logger } from '@nestjs/common'
import { Pool } from 'pg'

export interface ProbeResult {
  reachable: boolean
  latencyMs: number
  error?: string
}

@Injectable()
export class DatabaseProbeService {
  private readonly logger = new Logger(DatabaseProbeService.name)

  async probe(databaseUrl: string, options?: { timeout?: number }): Promise<ProbeResult> {
    const start = Date.now()
    const timeout = options?.timeout ?? 5_000
    const probePool = new Pool({
      connectionString: databaseUrl.trim(),
      max: 1,
      connectionTimeoutMillis: timeout,
      idleTimeoutMillis: 1_000,
      allowExitOnIdle: true,
    })
    try {
      await probePool.query('SELECT 1')
      const latency = Date.now() - start
      return { reachable: true, latencyMs: latency }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { reachable: false, latencyMs: Date.now() - start, error: this.categorizeError(message) }
    } finally {
      await probePool.end().catch(() => undefined)
    }
  }

  async probeWithRetry(databaseUrl: string, maxRetries = 3): Promise<ProbeResult> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.probe(databaseUrl, { timeout: 5_000 })
      if (result.reachable) return result
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
      }
    }
    return this.probe(databaseUrl, { timeout: 5_000 })
  }

  private categorizeError(message: string): string {
    if (message.includes('ECONNREFUSED')) return 'Connection refused — is the database running?'
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) return 'Connection timed out — check network/firewall.'
    if (message.includes('ENOTFOUND')) return 'Hostname not resolved — check DNS.'
    if (message.includes('password') || message.includes('authentication')) return 'Authentication failed.'
    if (message.includes('does not exist')) return 'Database does not exist.'
    return `Database error: ${message}`
  }
}
