import { Logger } from '@nestjs/common'
import { Context, Effect } from 'effect'

import { runPromiseUnwrapped } from '@deployer/effect-core'
import { AppLifecyclePhase, type AppLifecycleShape } from '@deployer/lifecycle'
import type { NodeConfigRepositoryShape } from '@deployer/node-state'

import { DatabaseStartupBlocked } from '../database.errors'

import type {
    DatabaseProbeServiceShape,
    ProbeResult,
} from './database-probe.service'
import type { Pool } from 'pg'

export type DatabaseStartupGuardShape = {
    /**
     * Verifies the shared pool answers before the boot continues: waits for a
     * database that is still starting, tries a stopped dev container, and
     * otherwise fails with a diagnostic (and the lifecycle in ERROR). Skips when
     * no database URL is configured yet.
     */
    readonly ensureDatabaseAvailable: (
        pool: Pool
    ) => Effect.Effect<void, DatabaseStartupBlocked>
}

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
 * declaring the platform broken. The bound is generous enough to cover a swarm
 * task being placed and started, and still fails fast when the database
 * genuinely is not coming up.
 */
const CONNECT_WAIT_MS = 60_000

/** Backoff between connectivity attempts. */
const CONNECT_RETRY_MS = 2_000

export class DatabaseStartupGuard extends Context.Service<
    DatabaseStartupGuard,
    DatabaseStartupGuardShape
>()('shared/DatabaseStartupGuard') {
    /**
     * Collaborators are constructor arguments: the shape's channel is
     * `DatabaseStartupBlocked` alone, which the method produces itself.
     */
    static readonly live = class DatabaseStartupGuardImpl
        implements DatabaseStartupGuardShape
    {
        private readonly logger = new Logger('DatabaseStartupGuard')

        constructor(
            private readonly nodeConfigRepository: NodeConfigRepositoryShape,
            private readonly lifecycle: Pick<
                AppLifecycleShape,
                'transitionNow'
            >,
            private readonly probeService: DatabaseProbeServiceShape
        ) {}

        private probe(
            url: string,
            options?: { timeout?: number }
        ): Promise<ProbeResult> {
            return runPromiseUnwrapped(
                this.probeService.probe(url, options)
            )
        }

        ensureDatabaseAvailable(
            pool: Pool
        ): Effect.Effect<void, DatabaseStartupBlocked> {
            return Effect.tryPromise({
                try: () => this.attemptEnsure(pool),
                catch: (cause) =>
                    cause instanceof DatabaseStartupBlocked
                        ? cause
                        : new DatabaseStartupBlocked({
                              reason:
                                  cause instanceof Error
                                      ? cause.message
                                      : String(cause),
                              cause,
                          }),
            })
        }

        /** The body of `ensureDatabaseAvailable`, as plain async code. */
        private async attemptEnsure(pool: Pool): Promise<void> {
            const url = (
                await runPromiseUnwrapped(this.nodeConfigRepository.find())
            )?.databaseUrl?.trim()
            if (!url) {
                this.logger.log(
                    '⏭ No database URL configured — skipping startup guard'
                )
                return
            }
            this.lifecycle.transitionNow(AppLifecyclePhase.PROBING, {
                message: 'Testing database connectivity…',
            })

            const reachable = await this.tryPoolConnect(pool)
            if (reachable) {
                this.logger.log('✅ Database reachable')
                return
            }

            // Not reachable on the first try — almost always because the
            // dependency is still starting (swarm scheduling is asynchronous).
            // Wait for it.
            if (await this.waitForDatabase(pool, url)) {
                this.logger.log(
                    '✅ Database reachable (after waiting for it to start)'
                )
                return
            }

            const recovered = await this.tryDockerContainerRecovery()
            if (recovered) {
                this.logger.log(
                    '✅ Database recovered via Docker container restart'
                )
                return
            }

            const probeResult = await this.probe(url)

            // If the probe succeeded but the global pool failed, the pool was
            // created with a stale/empty connection string (e.g. placeholder
            // pool from module init before the URL was written to SQLite). The
            // app cannot recover the pool at this point — fail with a clear
            // diagnostic.
            if (probeResult.reachable) {
                const msg =
                    'Global database pool has wrong connection string (stale URL) — restart required'
                this.logger.error(msg)
                this.lifecycle.transitionNow(AppLifecyclePhase.ERROR, {
                    error: msg,
                    databaseReachable: false,
                })
                throw new DatabaseStartupBlocked({ reason: msg })
            }

            const errorMessage = this.buildDiagnostic(
                url,
                probeResult.error ?? 'Unreachable'
            )
            this.logger.error(errorMessage)
            this.lifecycle.transitionNow(AppLifecyclePhase.ERROR, {
                error: errorMessage,
                databaseReachable: false,
            })
            throw new DatabaseStartupBlocked({ reason: errorMessage })
        }

        /**
         * One `SELECT 1` over the shared pool. `false` means "not usable right
         * now" (pool error, refused connection, unresolvable host, failing
         * query) — the caller decides whether that is fatal or just early.
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
         * Poll until the database answers or `CONNECT_WAIT_MS` elapses. Logs
         * once at the start (so a slow dependency is visible) rather than on
         * every attempt.
         */
        private async waitForDatabase(
            pool: Pool,
            url: string
        ): Promise<boolean> {
            const host = this.safeHost(url)
            this.logger.log(
                `⏳ Database at ${host} is not reachable yet — waiting up to ${String(CONNECT_WAIT_MS / 1000)}s for it to start…`
            )

            const deadline = Date.now() + CONNECT_WAIT_MS
            let attempts = 0
            while (Date.now() < deadline) {
                await new Promise((resolve) =>
                    setTimeout(resolve, CONNECT_RETRY_MS)
                )
                attempts += 1
                if (await this.tryPoolConnect(pool)) {
                    this.logger.log(
                        `Database became reachable after ${String(attempts)} attempt(s)`
                    )
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
                const { default: Dockerode } =
                    (await import('dockerode')) as unknown as {
                        default: new () => {
                            getContainer: (id: string) => unknown
                        }
                    }
                const docker = new Dockerode()
                // dockerode's own types are loose here; name the two calls this
                // probe makes.
                const container = docker.getContainer(
                    'deployer-postgres-dev'
                ) as {
                    inspect: () => Promise<{ State?: { Running?: boolean } }>
                    start: () => Promise<unknown>
                }
                const info = await container.inspect()
                if (info.State?.Running === true) return false
                this.logger.log('🔄 Restarting stopped Postgres container...')
                await container.start()
                const storedUrl =
                    (await runPromiseUnwrapped(this.nodeConfigRepository.find()))
                        ?.databaseUrl ?? ''
                for (let i = 0; i < 30; i++) {
                    const r = await this.probe(storedUrl, { timeout: 2_000 })
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
}
